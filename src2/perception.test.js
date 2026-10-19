// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cleanLabel, looksLikeExample } from './normalize.js';
import { resolveLabel } from './label-chain.js';
import { evaluateField } from './visibility.js';
import { createRegistry } from './registry.js';
import { buildSnapshot, locateField, PerceptionPrivacyError } from './snapshot.js';

let override = null;
let last = null;
const env = {
  isHidden: (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.inert || node.hasAttribute('data-hide') || node.getAttribute('aria-hidden') === 'true') return true;
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
    }
    return false;
  },
  isVisible: (el) => !env.isHidden(el),
  rectOf: (el) => { last = el; return { x: 0, y: 0, w: 100, h: 20 }; },
  viewport: () => ({ w: 1000, h: 1000, dpr: 1 }),
  topAt: () => override || last,
};
const passthrough = (s) => s;
const $ = (h) => { document.body.innerHTML = h; };
const flatten = (snap) => {
  const out = [];
  const v = (list) => list.forEach((i) => (i.type === 'field' ? out.push(i) : i.children && v(i.children)));
  v(snap.tree);
  return out;
};
const shape = (list) =>
  list.map((i) => i.type === 'field'
    ? `f:${i.label}`
    : i.type === 'button'
      ? `b:${i.text}`
      : i.type === 'context'
        ? `c:${i.text}`
        : `${i.type}:${i.title}[${shape(i.children).join(',')}]`);

beforeEach(() => { override = null; last = null; document.title = ''; });

describe('normalize', () => {
  it('cleans labels', () => expect(cleanLabel('  Full name * (optional):')).toBe('Full name'));
  it('detects example placeholders', () => {
    for (const p of ['DD/MM/YYYY', '9876543210', 'name@example.com', 'e.g. John']) expect(looksLikeExample(p)).toBe(true);
    for (const p of ['Enter your name', 'PAN number']) expect(looksLikeExample(p)).toBe(false);
  });
});

describe('label ladder', () => {
  it('for/id label wins', () => { $('<label for="a">Email *</label><input id="a">'); expect(resolveLabel(document.getElementById('a'))).toMatchObject({ text: 'Email', source: 'label' }); });
  it('wrapping label ignores select options', () => { $('<label>State <select id="s"><option>Karnataka</option></select></label>'); expect(resolveLabel(document.getElementById('s')).text).toBe('State'); });
  it('aria-label', () => { $('<input id="a" aria-label="Mobile">'); expect(resolveLabel(document.getElementById('a')).source).toBe('aria-label'); });
  it('example placeholder is skipped, meaningful identifier is a low-confidence fallback', () => {
    $('<input id="a" placeholder="DD/MM/YYYY" name="date_of_birth">');
    expect(resolveLabel(document.getElementById('a'))).toMatchObject({ text: 'date of birth', source: 'identifier', guessed: true, confidence: 'low' });
  });
  it('react ids are not names', () => { $('<div>Phone</div><input id=":r1:">'); expect(resolveLabel(document.getElementById(':r1:'))).toMatchObject({ source: 'adjacent', guessed: true }); });
  it('nearby text never steals a neighbour label', () => { $('<div><input id="x" aria-label="X"></div><div><input id="y"></div>'); expect(resolveLabel(document.getElementById('y'))).toBeNull(); });
  it('page title is not used as a nearby field label', () => {
    document.title = 'Double Submission or Refresh';
    $('<form><input id="a"></form>');
    expect(resolveLabel(document.getElementById('a'))).toBeNull();
  });
  it('none -> null', () => { $('<input id="a">'); expect(resolveLabel(document.getElementById('a'))).toBeNull(); });
});

describe('field rules', () => {
  const r = (h, id = 'a') => { $(h); return evaluateField(document.getElementById(id), env, document); };
  it('ok', () => expect(r('<input id="a">')).toMatchObject({ ok: true, coverage: 'clear' }));
  it('excludes action-only inputs and represents password, disabled, and readonly fields', () => {
    expect(r('<input id="a" type="submit">').reason).toBe('type');
    expect(r('<input id="a" type="password">')).toMatchObject({ ok: true });
    expect(r('<input id="a" disabled>')).toMatchObject({ ok: true, disabled: true });
    expect(r('<input id="a" readonly>')).toMatchObject({ ok: true, readonly: true });
  });
  it('hidden, honeypot, chrome', () => {
    expect(r('<div data-hide><input id="a"></div>').reason).toBe('hidden');
    expect(r('<div aria-hidden="true"><input id="a" tabindex="-1"></div>').reason).toBe('honeypot');
    expect(r('<header><input id="a"></header>').reason).toBe('chrome');
    expect(r('<main><header><input id="a"></header></main>').ok).toBe(true);
  });
  it('covered by overlay', () => { $('<input id="a"><div id="m"></div>'); override = document.getElementById('m'); expect(evaluateField(document.getElementById('a'), env, document).reason).toBe('covered'); });
  it('custom checkbox passes via visible label', () => {
    $('<label><input id="a" type="checkbox" data-hide> Agree</label>');
    const e2 = { ...env, isVisible: (el) => el.tagName === 'LABEL' };
    expect(evaluateField(document.getElementById('a'), e2, document).ok).toBe(true);
  });
});

describe('snapshot', () => {
  const build = (extra = {}) => buildSnapshot({ doc: document, registry: reg, sanitizeText: passthrough, env, ...extra });
  let reg;
  beforeEach(() => { reg = createRegistry(); });

  it('builds a snapshot from the captured Sarathi eKYC form DOM', () => {
    const capturedDom = readFileSync('fixtures/sarathi-ekyc-page.html', 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<link\b(?=[^>]*\brel=["']?stylesheet\b)[^>]*>/gi, '');
    const page = new JSDOM(
      capturedDom,
      { url: 'https://sarathi.parivahan.gov.in/sarathiservice/newLL_execute.do' },
    );
    const modalVisibility = page.window.document.createElement('style');
    modalVisibility.textContent = '.modal:not(.in) { display: none; }';
    page.window.document.head.append(modalVisibility);
    const s = build({ doc: page.window.document });
    const fields = flatten(s);

    expect(s.page).toMatchObject({
      host: 'sarathi.parivahan.gov.in',
      path: '/sarathiservice/newLL_execute.do',
      title: 'eKYC Form',
    });
    expect(s.groups).toEqual([
      { id: 'g1', title: '', fieldCount: 10, isDefault: true },
      { id: 'page', title: '', fieldCount: 3 },
    ]);
    expect(fields).toHaveLength(13);
    expect(fields.filter((field) => field.kind === 'radio')).toHaveLength(4);
    expect(fields.filter((field) => field.kind === 'checkbox')).toHaveLength(3);
    expect(fields.map((field) => field.label)).toContain('Submit via Aadhaar Authentication');
    expect(fields.map((field) => field.label)).toContain('Submit Using Sarathi Mobile Authentication');
    expect(fields.map((field) => field.label).some((label) => label.startsWith('I hereby state'))).toBe(true);
    const ideal = JSON.parse(readFileSync('fixtures/sarathi-ekyc-ideal-vdom.json', 'utf8'));
    const idealLabels = [];
    const collectIdealLabels = (nodes) => nodes.forEach((node) => {
      if (node.type === 'field') idealLabels.push(node.label);
      if (node.children) collectIdealLabels(node.children);
    });
    collectIdealLabels(ideal.tree.children);
    expect(idealLabels.filter((label) => !fields.some((field) => field.label === label))).toEqual([]);
    expect(fields.map((field) => field.label)).not.toContain('aadhaar holding type');
    expect(fields.find((field) => field.label === 'State').disabled).toBe(true);
    expect(s.completeness).toMatchObject({ complete: false, unsupported: [{ kind: 'iframe', count: 1 }] });
    expect(JSON.stringify(s)).not.toContain('aadharNumber');
    expect(JSON.stringify(s)).not.toContain('otpNumber');
  });

  it('recognises the pasted Sarathi resubmission-error page', () => {
    document.title = 'Double Submission or Refresh';
    $('<main><form><h4>Invalid Token for Resubmit or Refresh</h4><ul class="errorMessage"><li><span>The form has already been processed or no token was supplied, please try again.</span></li></ul><input type="submit" value="Home"></form></main>');

    const s = build();
    expect(s.page.title).toBe('Double Submission or Refresh');
    expect(shape(s.tree)).toEqual([
      'form:[section:Invalid Token for Resubmit or Refresh[c:The form has already been processed or no token was supplied, please try again.,b:Home]]',
    ]);
    expect(s.skipped).toEqual({ type: 1 });
    expect(s.groups).toEqual([{ id: 'g1', title: '', fieldCount: 0, isDefault: true }]);
  });

  it('never contains typed values, reports empty flag', () => {
    $('<form><label>PAN <input id="p" value="ABCDE1234F"></label><label>Name <input></label></form>');
    const s = build();
    expect(JSON.stringify(s)).not.toContain('ABCDE1234F');
    const f = flatten(s);
    expect(f.map((x) => x.empty)).toEqual([false, true]);
  });
  it('skip counts, needsCrop, guessed flag', () => {
    $('<form><input aria-label="A"><input disabled aria-label="B"><div>Phone</div><input id="n"><input id="u"></form>');
    const s = build();
    expect(s.skipped).toEqual({});
    expect(flatten(s).find((f) => f.ref && f.guessed)).toBeTruthy();
    expect(flatten(s).find((f) => f.label === 'B').disabled).toBe(true);
    expect(s.needsCrop.length).toBe(1);
  });
  it('fails closed', () => {
    $('<input aria-label="A">');
    expect(() => build({ sanitizeText: () => { throw new Error('x'); } })).toThrow(PerceptionPrivacyError);
    expect(() => build({ sanitizeText: undefined })).toThrow(PerceptionPrivacyError);
    expect(() => build({ sanitizeText: () => 5 })).toThrow(PerceptionPrivacyError);
  });
  it('sanitises labels and page text', () => {
    $('<label>Ramesh Kumar <input></label>'); document.title = 'Hi Ramesh';
    const s = build({ sanitizeText: (t) => t.replace(/Ramesh/g, '<NAME_1>') });
    expect(JSON.stringify(s)).not.toContain('Ramesh');
  });
  it('radio group: legend becomes group title, emptiness uses whole group', () => {
    $('<fieldset><legend>Gender</legend><label><input type="radio" name="g" checked>M</label><label><input type="radio" name="g">F</label></fieldset>');
    const s = build();
    expect(shape(s.tree)).toEqual(['group:Gender[f:M,f:F]']);
    expect(flatten(s).every((x) => x.empty === false)).toBe(true);
  });

  it('labels general radio and consent choices and preserves their state', () => {
    $('<form><fieldset><legend>Preferred contact</legend><input id="email" type="radio" name="contact" checked><label for="email">Email</label><input id="phone" type="radio" name="contact"><label for="phone">Phone</label><div role="group" aria-labelledby="consent-title"><span id="consent-title">Privacy permissions</span><div role="checkbox" aria-checked="true" aria-labelledby="permission-label"></div><span id="permission-label">Share updates</span></div></fieldset></form>');
    const fields = flatten(build());
    expect(fields.map(({ label, question, checked }) => ({ label, question, checked }))).toEqual([
      { label: 'Email', question: 'Preferred contact', checked: true },
      { label: 'Phone', question: 'Preferred contact', checked: false },
      { label: 'Share updates', question: 'Privacy permissions', checked: 'true' },
    ]);
  });

  it('supports ARIA and contenteditable controls without exposing their text values', () => {
    $('<form><div role="textbox" aria-label="Work summary">Private draft text</div><div contenteditable="true" aria-labelledby="notes-label">Sensitive notes</div><span id="notes-label">Notes</span><div role="combobox" aria-label="Region"><div role="option" aria-selected="true">North</div><div role="option">South</div></div></form>');
    const s = build();
    const serialized = JSON.stringify(s);
    expect(flatten(s).map((field) => field.label)).toEqual(['Work summary', 'Notes', 'Region']);
    expect(serialized).toContain('"selectedOptions":["North"]');
    expect(serialized).not.toContain('Private draft text');
    expect(serialized).not.toContain('Sensitive notes');
  });

  it('excludes hidden descendants and reports unsupported DOM boundaries', () => {
    $('<form><label>Visible<input aria-label="Visible"></label><div hidden><label>Hidden<input aria-label="Hidden"></label></div><div aria-hidden="true"><label>Ignored<input aria-label="Ignored"></label></div></form><iframe></iframe><canvas></canvas>');
    const host = document.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML = '<input aria-label="Shadow control">';
    document.body.append(host);
    const s = build();
    expect(flatten(s).map((field) => field.label)).toEqual(['Visible']);
    expect(s.completeness).toEqual({
      complete: false,
      unsupported: [
        { kind: 'iframe', count: 1 },
        { kind: 'openShadowRoot', count: 1 },
        { kind: 'canvas', count: 1 },
      ],
    });
  });
});

describe('locateField', () => {
  let reg;
  beforeEach(() => { reg = createRegistry(); });
  const snap = () => buildSnapshot({ doc: document, registry: reg, sanitizeText: passthrough, env });
  const L = (ref) => locateField({ ref, doc: document, registry: reg, env });

  it('same node -> ok', () => { $('<form><label>Email <input></label></form>'); const r = flatten(snap())[0].ref; expect(L(r).ok).toBe(true); });
  it('refs from an older snapshot are rejected rather than reused', () => {
    $('<form><label>Email <input></label><label>Phone <input></label></form>');
    const staleRef = flatten(snap())[0].ref;
    snap();
    expect(L(staleRef)).toEqual({ ok: false, reason: 'unknown-ref' });
  });
  it('React-style replacement rebinds', () => {
    $('<form><label>Email <input id="a"></label></form>');
    const r = flatten(snap())[0].ref;
    document.querySelector('form').innerHTML = '<label>Email <input id="b"></label>';
    const res = L(r); expect(res).toMatchObject({ ok: true, rebound: true }); expect(res.el.id).toBe('b');
  });
  it('duplicates after swap -> ambiguous', () => {
    $('<form><label>Email <input></label></form>');
    const r = flatten(snap())[0].ref;
    document.querySelector('form').innerHTML = '<label>Email <input></label><label>Email <input></label>';
    expect(L(r)).toEqual({ ok: false, reason: 'ambiguous' });
  });
  it('wrong-but-present (label changed) -> gone, not filled', () => {
    $('<form><label>Email <input id="a"></label></form>');
    const r = flatten(snap())[0].ref;
    document.querySelector('label').firstChild.textContent = 'Phone ';
    expect(L(r)).toEqual({ ok: false, reason: 'gone' });
  });
  it('covered at fill time is reported', () => {
    $('<form><label>Email <input id="a"></label></form><div id="m"></div>');
    const r = flatten(snap())[0].ref; override = document.getElementById('m');
    expect(L(r)).toEqual({ ok: false, reason: 'covered' });
  });
  it('disabled and readonly controls cannot be located for filling', () => {
    $('<form><label>Disabled<input disabled></label><label>Readonly<input readonly></label></form>');
    const refs = flatten(snap()).map((field) => field.ref);
    expect(L(refs[0])).toEqual({ ok: false, reason: 'disabled' });
    expect(L(refs[1])).toEqual({ ok: false, reason: 'readonly' });
  });
});

describe('tree', () => {
  let reg;
  beforeEach(() => { reg = createRegistry(); });
  const snap = (sanitizeText = passthrough) => buildSnapshot({ doc: document, registry: reg, sanitizeText, env });

  it('React div soup: headings become sections, wrappers collapse', () => {
    $('<div id="root"><div><h2>Applicant</h2><div><div><label>Name <input></label></div><div><label>DOB <input></label></div></div><h2>Contact</h2><div><label>Phone <input></label></div></div></div>');
    expect(shape(snap().tree)).toEqual(['section:Applicant[f:Name,f:DOB]', 'section:Contact[f:Phone]']);
  });
  it('heading levels nest', () => {
    $('<h2>A</h2><h3>B</h3><label>X<input></label><h2>C</h2><label>Y<input></label>');
    expect(shape(snap().tree)).toEqual(['section:A[section:B[f:X]]', 'section:C[f:Y]']);
  });
  it('headings do not leak across sibling wrappers', () => {
    $('<div><h2>A</h2><label>X<input></label></div><div><label>Y<input></label></div>');
    expect(shape(snap().tree)).toEqual(['section:A[f:X,f:Y]']);
  });
  it('preserves untitled semantic groups and keeps forms', () => {
    $('<div role="group"><label>A<input></label></div><form><label>B<input></label></form>');
    expect(shape(snap().tree)).toEqual(['group:[f:A]', 'form:[f:B]']);
  });
  it('dialog kept, empty/hidden parts dropped', () => {
    $('<div role="dialog"><label>Code<input></label></div><div role="dialog"><h2 data-hide>Secret</h2></div>');
    expect(shape(snap().tree)).toEqual(['dialog:[f:Code]']);
  });
  it('buttons: text only, visible, outside chrome, without dropping later buttons', () => {
    $('<form><label>A<input></label><button type="submit">Next</button><button></button><button data-hide>Hidden</button></form><header><button>Login</button></header>');
    const t = snap().tree;
    expect(shape(t)).toEqual(['form:[f:A,b:Next]']);
    expect(t[0].children[1].submit).toBe(true);
    $('<div>' + '<button>b</button>'.repeat(40) + '</div>');
    expect(snap().tree.length).toBe(40);
  });
  it('field inside a role=button wrapper is not lost', () => {
    $('<div role="button"><label>Date <input></label></div>');
    expect(shape(snap().tree)).toEqual(['f:Date']);
  });
  it('hidden headings are ignored', () => {
    $('<h2 data-hide>Secret</h2><label>A<input></label>');
    expect(shape(snap().tree)).toEqual(['f:A']);
  });
  it('groups: each form, plus page for loose fields, largest is default', () => {
    $('<form><input aria-label="A"></form><input aria-label="B"><input aria-label="C">');
    expect(snap().groups).toEqual([
      { id: 'g1', title: '', fieldCount: 1 },
      { id: 'page', title: '', fieldCount: 2, isDefault: true },
    ]);
  });
  it('headings and button text are sanitised', () => {
    $('<h2>Ramesh details</h2><label>A<input></label><button>Ramesh next</button>');
    const out = JSON.stringify(snap((t) => t.replace(/Ramesh/g, '<NAME_1>')));
    expect(out).not.toContain('Ramesh');
    expect(out).toContain('<NAME_1>');
  });
  it('tree order equals fill order (DOM order)', () => {
    $('<h2>S</h2><label>1<input></label><fieldset><legend>G</legend><label>2<input></label></fieldset><label>3<input></label>');
    expect(flatten(snap()).map((f) => f.label)).toEqual(['1', '2', '3']);
  });
});
