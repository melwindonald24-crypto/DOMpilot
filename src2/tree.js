import { cleanLabel } from './normalize.js';
import { textWithoutControls, labelledByText } from './label-chain.js';
import { FIELD_SELECTOR, inChrome } from './visibility.js';

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg']);
const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const BUTTON = 'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"], input[type="image"]';
const CONTAINER = 'form, fieldset, dialog, [role="dialog"], [role="group"], [role="radiogroup"], [role="tabpanel"], details';
function containerTitle(el) {
  const first = (tag) => [...el.children].find((c) => c.localName === tag);
  if (el.localName === 'fieldset' && first('legend')) return cleanLabel(textWithoutControls(first('legend')), 512);
  if (el.localName === 'details' && first('summary')) return cleanLabel(textWithoutControls(first('summary')), 512);
  const a = cleanLabel(el.getAttribute('aria-label'), 512);
  if (a) return a;
  const by = cleanLabel(labelledByText(el), 512);
  if (by) return by;
  const title = cleanLabel(el.getAttribute('title'), 512);
  if (title) return title;
  return '';
}

// Tree of fields and actions with headings, instructions, and semantic groups.
// Generic wrappers collapse, but headings remain in document order across them.
// `fieldByEl` maps each accepted field element to its ready-made wire node.
export function buildTree(root, fieldByEl, env, safe) {
  const headingItem = (el) => {
    if (!env.isVisible(el) || inChrome(el)) return null;
    const text = cleanLabel(textWithoutControls(el), 512);
    if (!text) return null;
    const level = /^H([1-6])$/.test(el.tagName) ? +el.tagName[1] : parseInt(el.getAttribute('aria-level'), 10) || 2;
    return { type: 'heading', level, text: safe(text) };
  };

  const buttonNode = (el) => {
    if (!env.isVisible(el) || inChrome(el)) return null;
    const raw = el.localName === 'input'
      ? el.type === 'image' ? el.getAttribute('alt') : el.value
      : el.getAttribute('aria-label') || textWithoutControls(el);
    const text = cleanLabel(raw, 512);
    if (!text) return null; // icon-only
    const node = { type: 'button', text: safe(text) };
    // untyped <button> defaults to submit even outside a form; only flag real ones
    if (el.type === 'submit' && (el.form || el.getAttribute('type') === 'submit')) node.submit = true;
    if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') node.disabled = true;
    return node;
  };

  const containerNode = (el, kids) => {
    if (!kids.length) return null;
    const title = safe(containerTitle(el));
    const isForm = el.localName === 'form';
    const isDialog = el.matches('dialog, [role="dialog"]');
    return { type: isForm ? 'form' : isDialog ? 'dialog' : 'group', title, children: kids };
  };

  const append = (target, headings, item) => {
    const section = headings[headings.length - 1];
    (section ? section.node.children : target).push(item);
  };

  const walk = (parent, target, headings = []) => {
    for (const el of parent.children) {
      if (env.isHidden?.(el)) continue;
      const field = fieldByEl.get(el);
      if (field) {
        append(target, headings, field);
        continue;
      }
      if (SKIP.has(el.localName)) continue;
      // A "button"/"heading" wrapping a real field (some date pickers) is walked, not summarised.
      const leaf = !el.querySelector(`${FIELD_SELECTOR}, ${BUTTON}`);
      if (leaf && el.matches(HEADING)) {
        const h = headingItem(el);
        if (h) {
          while (headings.length && headings[headings.length - 1].level >= h.level)
            headings.pop();
          const node = { type: 'section', title: h.text, children: [] };
          append(target, headings, node);
          headings.push({ level: h.level, node });
        }
        continue;
      }
      if (leaf && el.matches(BUTTON)) {
        const b = buttonNode(el);
        if (b) append(target, headings, b);
        continue;
      }
      if (leaf && el.matches('p, li, blockquote, [role="note"], [role="status"], output') &&
          !(el.localName === 'li' && el.querySelector('a, [role="link"]')) &&
          !inChrome(el)) {
        const text = cleanLabel(textWithoutControls(el), 512);
        if (text) append(target, headings, { type: 'context', text: safe(text) });
        continue;
      }
      if (el.matches(CONTAINER)) {
        const children = [];
        walk(el, children);
        const node = containerNode(el, children);
        if (node) append(target, headings, node);
        continue;
      }
      walk(el, target, headings);
    }
  };

  const tree = [];
  walk(root, tree);
  const pruneEmptySections = (items) => items.filter((item) =>
    item.type !== 'section' || (item.children = pruneEmptySections(item.children)).length,
  );
  const prunedTree = pruneEmptySections(tree);

  // Safety net: never lose an accepted field because of an odd structure.
  const seen = new Set();
  const collect = (list) => list.forEach((i) => (i.type === 'field' ? seen.add(i.ref) : i.children && collect(i.children)));
  collect(prunedTree);
  for (const f of fieldByEl.values()) if (!seen.has(f.ref)) prunedTree.push(f);
  return prunedTree;
}

// Review-screen groups: each <form> is one, all fields outside any form are "page".
export function listGroups(tree) {
  const groups = [];
  let loose = 0;
  const count = (list) => list.reduce((n, i) => n + (i.type === 'field' ? 1 : i.children ? count(i.children) : 0), 0);
  const visit = (list) => {
    for (const it of list) {
      if (it.type === 'field') loose++;
      else if (it.type === 'form') {
        it.id = `g${groups.length + 1}`;
        groups.push({ id: it.id, title: it.title, fieldCount: count(it.children) });
      } else if (it.children) visit(it.children);
    }
  };
  visit(tree);
  if (loose) groups.push({ id: 'page', title: '', fieldCount: loose });
  let best = 0;
  groups.forEach((g, i) => {
    if (g.fieldCount > groups[best].fieldCount) best = i;
  });
  if (groups.length) groups[best].isDefault = true;
  return groups;
}
