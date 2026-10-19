import { cleanLabel, looksLikeExample } from './normalize.js';
import { resolveLabelInfo, questionOf, sectionOf } from './label-chain.js';
import { isDisabled, NATIVE } from './visibility.js';

export function kindOf(el) {
  const tag = el.tagName.toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (['checkbox', 'combobox', 'listbox', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'textbox'].includes(role))
    return role;
  if (tag === 'select') return el.multiple ? 'select-multiple' : 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') return (el.type || 'text').toLowerCase();
  if (el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
  const editable = el.hasAttribute('contenteditable') &&
    el.getAttribute('contenteditable').toLowerCase() !== 'false';
  return role || (el.isContentEditable || editable ? 'contenteditable' : 'text');
}

// Local-only check. The value itself is never copied into the description.
export function isEmpty(el, kind = kindOf(el)) {
  if (kind === 'checkbox' || kind === 'switch') {
    const checked = el.getAttribute('aria-checked');
    return el.checked !== undefined ? !el.checked : checked !== 'true' && checked !== 'mixed';
  }
  if (kind === 'radio') {
    if (el.getAttribute('role') === 'radio') return el.getAttribute('aria-checked') !== 'true';
    const same = el.name
      ? [...el.ownerDocument.querySelectorAll('input[type="radio"]')].filter((r) => r.name === el.name && r.form === el.form)
      : [el];
    return !same.some((r) => r.checked);
  }
  if (kind === 'file') return !(el.files && el.files.length);
  if (kind === 'select' || kind === 'select-multiple') {
    const o = el.selectedOptions && el.selectedOptions[0];
    if (!o) return true;
    return o.value === '' || o.disabled || (el.selectedIndex === 0 && /^(select|choose|--|—)/i.test(o.textContent.trim()));
  }
  if (kind === 'slider' || kind === 'spinbutton') return !el.hasAttribute('aria-valuenow');
  if (kind === 'combobox' || kind === 'listbox') {
    const selected = el.querySelector('[role="option"][aria-selected="true"]');
    if (selected) return false;
    if (kind === 'listbox') return true;
  }
  const value = 'value' in el ? el.value : el.textContent;
  return String(value || '').trim() === '';
}

function ariaOptions(el) {
  const roots = [el];
  const ids = [
    ...(el.getAttribute('aria-controls') || '').split(/\s+/),
    ...(el.getAttribute('aria-owns') || '').split(/\s+/),
  ].filter(Boolean);
  for (const id of ids) {
    const target = el.ownerDocument.getElementById(id);
    if (target) roots.push(target);
  }
  return [...new Set(roots.flatMap((root) => [
    ...(root.matches?.('[role="option"]') ? [root] : []),
    ...root.querySelectorAll('[role="option"]'),
  ]))];
}

// Raw, unsanitised, in-memory description. Never leaves the content script as-is.
export function describeField(el, env) {
  const kind = kindOf(el);
  const labelInfo = resolveLabelInfo(el, env);
  const d = {
    kind,
    native: el.matches(NATIVE),
    label: labelInfo.label,
    labelCandidates: labelInfo.candidates,
    question: ['radio', 'checkbox', 'switch'].includes(kind) ? questionOf(el) : '',
    section: sectionOf(el),
    required: el.required === true || el.getAttribute('aria-required') === 'true',
    disabled: isDisabled(el),
    readonly: el.readOnly === true || el.getAttribute('aria-readonly') === 'true',
    role: el.getAttribute('role') || undefined,
    autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase() || undefined,
    empty: isEmpty(el, kind),
    hints: {},
  };
  if (kind === 'radio' || kind === 'checkbox' || kind === 'switch') {
    d.checked = 'checked' in el
      ? Boolean(el.checked)
      : el.getAttribute('aria-checked') || 'false';
  }
  const ph = cleanLabel(
    el.getAttribute('placeholder') ||
    el.getAttribute('aria-placeholder') ||
    el.getAttribute('data-placeholder'),
  );
  if (ph && looksLikeExample(ph)) d.hints.example = ph;
  if (el.getAttribute('pattern')) d.hints.pattern = el.getAttribute('pattern').slice(0, 80);
  if (el.maxLength > 0) d.hints.maxLength = el.maxLength;
  if (kind === 'file') {
    d.accept = el.getAttribute('accept') || undefined;
    d.multiple = el.multiple || undefined;
  }
  if (kind === 'select' || kind === 'select-multiple' || kind === 'listbox' || kind === 'combobox') {
    const options = el.options ? [...el.options] : ariaOptions(el);
    const all = options.map((o) => cleanLabel(o.textContent)).filter(Boolean);
    d.optionCount = all.length;
    d.options = all.slice(0, 50);
    d.selectedOptions = options
      .filter((o) => o.selected || o.getAttribute('aria-selected') === 'true')
      .map((o) => cleanLabel(o.textContent))
      .filter(Boolean)
      .slice(0, 50);
  }
  return d;
}

// Identity used to re-find a field after React swaps the node.
export function fingerprintOf(d) {
  const n = (s) => (s || '').toLowerCase();
  return { label: n(d.label && d.label.text), kind: d.kind, section: n(d.section), question: n(d.question) };
}

export function sameFingerprint(a, b) {
  return a.label === b.label && a.kind === b.kind && a.section === b.section && a.question === b.question;
}
