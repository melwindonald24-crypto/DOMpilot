// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from './registry.js';
import { buildSnapshot, locateField } from './snapshot.js';

let lastTarget;
const env = {
  isHidden(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return true;
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
    }
    return false;
  },
  isVisible(el) {
    return !this.isHidden(el);
  },
  rectOf(el) {
    lastTarget = el;
    return { x: 0, y: 0, w: 120, h: 24 };
  },
  viewport() {
    return { w: 1280, h: 800, dpr: 1 };
  },
  topAt() {
    return lastTarget;
  },
};

const flatten = (nodes) => nodes.flatMap((node) =>
  node.type === 'field' ? [node] : node.children ? flatten(node.children) : [],
);

function snapshot(registry = createRegistry()) {
  return buildSnapshot({
    doc: document,
    registry,
    sanitizeText: (text) => text,
    env,
  });
}

describe('general DOM perception acceptance', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = '';
    lastTarget = null;
  });

  it('builds an ordered semantic tree across native and ARIA form patterns without exposing values', () => {
    document.body.innerHTML = `
      <main>
        <h1>Profile setup<span hidden>Hidden heading text</span></h1>
        <form aria-label="Contact details">
          <label for="full-name">Full name</label>
          <input id="full-name" name="fullName" autocomplete="name" required value="Private Person">
          <fieldset>
            <legend>Preferred contact</legend>
            <label><input type="radio" name="contact" value="email" checked>Email</label>
            <label><input type="radio" name="contact" value="phone">Phone</label>
          </fieldset>
          <label for="region">Region</label>
          <input id="region" role="combobox" aria-controls="region-options" aria-expanded="true">
          <ul id="region-options" role="listbox" aria-label="Region choices">
            <li role="option" aria-selected="true">North</li>
            <li role="option">South</li>
          </ul>
          <label for="access-code">Access code</label>
          <input id="access-code" type="password" value="Secret value">
          <div hidden><input aria-label="Hidden control"></div>
        </form>
      </main>`;

    const result = snapshot();
    const fields = flatten(result.tree);

    expect(result.tree.map((node) => node.type)).toEqual(['section']);
    expect(result.tree[0].title).toBe('Profile setup');
    expect(fields.map(({ label, kind }) => [label, kind])).toEqual([
      ['Full name', 'text'],
      ['Email', 'radio'],
      ['Phone', 'radio'],
      ['Region', 'combobox'],
      ['Region choices', 'listbox'],
      ['Access code', 'password'],
    ]);
    expect(fields.find((field) => field.label === 'Full name')).toMatchObject({
      required: true,
      empty: false,
    });
    expect(fields.filter((field) => field.kind === 'radio').map(({ question, checked }) => [question, checked]))
      .toEqual([['Preferred contact', true], ['Preferred contact', false]]);
    expect(fields.find((field) => field.label === 'Region')).toMatchObject({
      options: ['North', 'South'],
      selectedOptions: ['North'],
    });
    expect(JSON.stringify(result)).not.toContain('Private Person');
    expect(JSON.stringify(result)).not.toContain('Secret value');
    expect(JSON.stringify(result)).not.toContain('Hidden control');
    expect(JSON.stringify(result)).not.toContain('Hidden heading text');
  });

  it('recognizes additional custom widgets while excluding contenteditable=false and protecting values', () => {
    document.body.innerHTML = `
      <form>
        <label for="region-picker">Region</label>
        <button id="region-picker" aria-haspopup="listbox">Choose region</button>
        <div role="checkbox">Private consent detail</div>
        <div contenteditable="true" aria-label="Notes">Private draft</div>
        <div contenteditable="false" aria-label="Read-only text">Not a field</div>
      </form>`;

    const result = snapshot();
    const fields = flatten(result.tree);

    expect(fields.map(({ label, kind, widget }) => [label, kind, widget])).toEqual([
      ['Region', 'combobox', true],
      ['Private consent detail', 'checkbox', true],
      ['Notes', 'contenteditable', true],
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Private draft');
    expect(serialized).not.toContain('Not a field');
  });

  it('keeps action labels and reports nested unsupported boundaries without traversing shadow controls', () => {
    document.body.innerHTML = `
      <form>
        <input type="image" alt="Find records">
        <button type="button" aria-label="Open filters"></button>
        <div hidden><button>Hidden action</button></div>
        <div id="outer-shadow"></div>
      </form>`;
    const outer = document.getElementById('outer-shadow').attachShadow({ mode: 'open' });
    outer.innerHTML = '<input aria-label="Shadow-only field"><canvas></canvas><iframe></iframe><div id="inner-shadow"></div>';
    outer.getElementById('inner-shadow').attachShadow({ mode: 'open' }).innerHTML = '<textarea aria-label="Nested shadow field"></textarea>';

    const result = snapshot();
    const serialized = JSON.stringify(result);

    expect(result.tree.flatMap((node) => node.children || []).filter((node) => node.type === 'button').map((node) => node.text))
      .toEqual(['Find records', 'Open filters']);
    expect(flatten(result.tree).map((field) => field.label)).not.toContain('Shadow-only field');
    expect(flatten(result.tree).map((field) => field.label)).not.toContain('Nested shadow field');
    expect(result.completeness).toEqual({
      complete: false,
      unsupported: [
        { kind: 'iframe', count: 1 },
        { kind: 'openShadowRoot', count: 2 },
        { kind: 'canvas', count: 1 },
      ],
    });
    expect(serialized).not.toContain('Hidden action');
  });

  it('preserves full long nearby descriptions and action names', () => {
    const consent = `I agree that the information entered for this request may be used only to process this specific request and that I can review the details before continuing.`;
    const action = `Continue after reviewing the information provided`;
    document.body.innerHTML = `
      <form>
        <div>
          <input id="consent" type="checkbox">
          <p>${consent}</p>
        </div>
        <button type="button">${action}</button>
      </form>`;

    const result = snapshot();
    const field = flatten(result.tree).find((node) => node.kind === 'checkbox');
    const button = result.tree[0].children.find((node) => node.type === 'button');

    expect(field.label).toBe(consent);
    expect(button.text).toBe(action);
  });

  it('retains heading and instruction context across generic wrappers', () => {
    document.body.innerHTML = `
      <main>
        <h1>Application</h1>
        <div><div><h2>Applicant details</h2></div></div>
        <div><p>Enter the name exactly as it appears on the document.</p></div>
        <div><div><form><label for="name">Full name</label><input id="name"></form></div></div>
      </main>`;

    const result = snapshot();
    const pageSection = result.tree[0];
    const subSection = pageSection.children[0];

    expect(pageSection).toMatchObject({ type: 'section', title: 'Application' });
    expect(subSection).toMatchObject({ type: 'section', title: 'Applicant details' });
    expect(subSection.children).toContainEqual({
      type: 'context',
      text: 'Enter the name exactly as it appears on the document.',
    });
    expect(flatten([subSection]).map((field) => field.label)).toEqual(['Full name']);
  });

  it('preserves ambiguous nearby text instead of silently assigning a label', () => {
    document.body.innerHTML = `
      <form><div>
        <span>Office address</span><span>Billing address</span>
        <input name="address">
      </div></form>`;

    const result = snapshot();
    const [field] = flatten(result.tree);

    expect(field).toMatchObject({
      label: 'address',
      labelCandidates: ['Office address', 'Billing address'],
      labelSource: 'identifier',
    });
    expect(result.needsCrop).toEqual([]);
  });

  it('keeps explicit metadata when nearby text is ambiguous and distinguishes visible required hints', () => {
    document.body.innerHTML = `
      <form>
        <div><span>Office address</span><span>Billing address</span><input name="address" title="Address"></div>
        <div><span>Legal name</span><span>*</span><input name="legalName"></div>
      </form>`;

    const result = snapshot();
    const fields = flatten(result.tree);
    const address = fields.find((field) => field.kind === 'text' && field.label === 'Address');
    const legalName = fields.find((field) => field.label === 'Legal name');

    expect(address).toMatchObject({
      labelCandidates: ['Office address', 'Billing address'],
      labelSource: 'title',
    });
    expect(legalName).toMatchObject({
      required: false,
      requiredHint: { value: true, source: 'visible-marker' },
    });
  });

  it('invalidates all prior field references after rebuilding a snapshot', () => {
    const registry = createRegistry();
    document.body.innerHTML = '<label for="first">First value</label><input id="first">';
    const oldRef = flatten(snapshot(registry).tree)[0].ref;

    document.body.innerHTML = '<label for="second">Second value</label><input id="second">';
    const current = snapshot(registry);

    expect(flatten(current.tree)[0].ref).not.toBe(oldRef);
    expect(locateField({ ref: oldRef, doc: document, registry, env }))
      .toEqual({ ok: false, reason: 'unknown-ref' });
  });
});
