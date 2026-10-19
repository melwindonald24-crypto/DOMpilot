import { collectFields, evaluateField, defaultEnv } from './visibility.js';
import { describeField, fingerprintOf, sameFingerprint } from './describe.js';
import { buildTree, listGroups } from './tree.js';
import { cleanLabel } from './normalize.js';
import { textWithoutControls } from './label-chain.js';

export class PerceptionPrivacyError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'PerceptionPrivacyError';
  }
}

// Fail closed: a sanitiser that throws or returns junk aborts the whole snapshot.
function makeSafe(sanitizeText) {
  return (s) => {
    if (!s) return s;
    let out;
    try {
      out = sanitizeText(s);
    } catch {
      throw new PerceptionPrivacyError('sanitizer failed');
    }
    if (typeof out !== 'string') throw new PerceptionPrivacyError('sanitizer returned non-string');
    return out;
  };
}

function collectRaw(doc, registry, env) {
  registry.reset();
  const skipped = {};
  const entries = [];
  for (const el of collectFields(doc)) {
    const ev = evaluateField(el, env, doc);
    if (!ev.ok) {
      skipped[ev.reason] = (skipped[ev.reason] || 0) + 1;
      continue;
    }
    const d = describeField(el, env);
    const ref = registry.add(el, fingerprintOf(d));
    entries.push({ el, ref, d, coverage: ev.coverage });
  }
  return { entries, skipped };
}

function pageMeta(doc, safe) {
  const h1 = doc.querySelector('h1');
  return {
    host: doc.location.hostname,
    path: safe(doc.location.pathname),
    title: safe((doc.title || '').slice(0, 120)),
    heading: h1 ? safe(cleanLabel(textWithoutControls(h1), 120)) : undefined,
  };
}

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

function fieldNode({ ref, d, coverage }, safe) {
  return strip({
    type: 'field',
    ref,
    kind: d.kind,
    widget: d.native ? undefined : true,
    label: d.label ? safe(d.label.text) : undefined,
    labelSource: d.label ? d.label.source : 'none',
    guessed: d.label ? d.label.guessed : undefined,
    labelConfidence: d.label ? d.label.confidence : undefined,
    labelCandidates: d.labelCandidates.length ? d.labelCandidates.map(safe) : undefined,
    requiredHint: d.label?.requiredHint
      ? { value: true, source: d.label.requiredHint.source }
      : undefined,
    question: d.question ? safe(d.question) : undefined,
    section: d.section ? safe(d.section) : undefined,
    required: d.required,
    disabled: d.disabled,
    readonly: d.readonly,
    checked: d.checked,
    role: d.role,
    autocomplete: d.autocomplete,
    accept: d.accept,
    multiple: d.multiple,
    empty: d.empty,
    coverage,
    hints: Object.keys(d.hints).length
      ? strip({ ...d.hints, example: d.hints.example ? safe(d.hints.example) : undefined })
      : undefined,
    options: d.options ? d.options.map(safe) : undefined,
    selectedOptions: d.selectedOptions ? d.selectedOptions.map(safe) : undefined,
    optionCount: d.optionCount,
  });
}

function unsupportedContexts(doc) {
  const counts = { iframe: 0, openShadowRoot: 0, canvas: 0 };
  const visit = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.localName === 'iframe') counts.iframe++;
      if (el.localName === 'canvas') counts.canvas++;
      if (el.shadowRoot) {
        counts.openShadowRoot++;
        visit(el.shadowRoot);
      }
    }
  };
  visit(doc);
  const unsupported = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ kind, count }));
  return { complete: unsupported.length === 0, unsupported };
}

// No field values are ever included, only the boolean `empty`.
export function buildSnapshot({ doc = document, registry, sanitizeText, env = defaultEnv }) {
  if (typeof sanitizeText !== 'function') throw new PerceptionPrivacyError('sanitizeText is required');
  const safe = makeSafe(sanitizeText);
  const raw = collectRaw(doc, registry, env);

  const byEl = new Map();
  const needsCrop = [];
  for (const e of raw.entries) {
    byEl.set(e.el, fieldNode(e, safe));
    if (!e.d.label && !e.d.labelCandidates.length)
      needsCrop.push({ ref: e.ref, rect: env.rectOf(e.el) });
  }
  const tree = buildTree(doc.body, byEl, env, safe);

  return {
    page: pageMeta(doc, safe),
    groups: listGroups(tree),
    tree,
    skipped: raw.skipped,
    needsCrop,
    viewport: env.viewport(doc),
    completeness: unsupportedContexts(doc),
  };
}

// Fill-time re-find. Strict: exactly one field with the same fingerprint, else skip.
export function locateField({ ref, doc = document, registry, env = defaultEnv }) {
  const want = registry.fingerprintOf(ref);
  if (!want) return { ok: false, reason: 'unknown-ref' };

  const direct = registry.resolve(ref);
  if (direct && sameFingerprint(fingerprintOf(describeField(direct, env)), want)) {
    const ev = evaluateField(direct, env, doc);
    if (ev.ok && ev.disabled) return { ok: false, reason: 'disabled' };
    if (ev.ok && ev.readonly) return { ok: false, reason: 'readonly' };
    return ev.ok ? { ok: true, el: direct, coverage: ev.coverage } : { ok: false, reason: ev.reason };
  }

  const hits = [];
  for (const el of collectFields(doc)) {
    if (el === direct) continue;
    if (!sameFingerprint(fingerprintOf(describeField(el, env)), want)) continue;
    const ev = evaluateField(el, env, doc);
    if (ev.ok && !ev.disabled && !ev.readonly) hits.push({ el, coverage: ev.coverage });
  }
  if (hits.length === 1) {
    registry.rebind(ref, hits[0].el);
    return { ok: true, el: hits[0].el, coverage: hits[0].coverage, rebound: true };
  }
  return { ok: false, reason: hits.length ? 'ambiguous' : 'gone' };
}
