import {
  cleanLabel,
  looksLikeExample,
  isMeaningfulIdentifier,
  humanizeIdentifier,
} from "./normalize.js";

const CONTROLS = [
  "input",
  "select",
  "textarea",
  "button",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[aria-haspopup="listbox"]',
].join(", ");

function hidden(node) {
  const win = node.ownerDocument.defaultView;
  for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
    if (el.hidden || el.inert || el.getAttribute("aria-hidden") === "true") return true;
    if (el.localName === "dialog" && !el.open) return true;
    const style = win.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
  }
  return false;
}

function labelsOf(el) {
  if (el.labels) return [...el.labels];
  if (!el.id) return [];
  return [...el.ownerDocument.querySelectorAll("label[for]")]
    .filter((label) => label.htmlFor === el.id);
}

export function textWithoutControls(node) {
  const collect = (current, isRoot = false) => {
    if (current.nodeType === 3) return current.textContent || "";
    if (current.nodeType !== 1 && current.nodeType !== 9 && current.nodeType !== 11) return "";
    if (!isRoot && (hidden(current) || current.matches?.(`${CONTROLS}, script, style, noscript, template, svg`)))
      return "";
    return [...current.childNodes].map((child) => collect(child)).join("");
  };
  return collect(node, true);
}

export function labelledByText(el) {
  const ids = (el.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean);
  return ids
    .map((id) => {
      const n = el.ownerDocument.getElementById(id);
      return n && !hidden(n) ? textWithoutControls(n) : "";
    })
    .join(" ");
}

function autocompleteToken(el) {
  const tokens = (el.getAttribute("autocomplete") || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const real = tokens.filter(
    (t) =>
      !["on", "off", "shipping", "billing", "home", "work", "mobile"].includes(
        t,
      ) && !t.startsWith("section-"),
  );
  return real.length ? real[real.length - 1] : "";
}

function elementRect(el, env) {
  const raw = env?.rectOf ? env.rectOf(el) : el.getBoundingClientRect();
  const left = raw.x ?? raw.left;
  const top = raw.y ?? raw.top;
  const width = raw.w ?? raw.width;
  const height = raw.h ?? raw.height;
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    return null;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function visualDistance(a, b) {
  const horizontalGap = Math.max(0, a.left - b.right, b.left - a.right);
  const verticalGap = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  const verticalOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const horizontalOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const sameRow = verticalOverlap > 0 ||
    Math.abs((a.top + a.bottom - b.top - b.bottom) / 2) <= Math.max(a.height, b.height);
  const sameColumn = horizontalOverlap > 0;

  if (sameRow && horizontalGap <= Math.max(360, b.height * 6))
    return horizontalGap + verticalGap * 3;
  if (sameColumn && verticalGap <= Math.max(96, b.height * 3))
    return verticalGap + horizontalGap * 3;
  return Infinity;
}

function isTextCandidate(el) {
  if (el.matches(CONTROLS) || el.querySelector(CONTROLS)) return false;
  return Boolean(cleanLabel(textWithoutControls(el), 512));
}

function hasStructuredText(el) {
  return el.matches('label, p, h1, h2, h3, h4, h5, h6, [role="note"], [role="status"]') ||
    Boolean(el.querySelector('label, p, h1, h2, h3, h4, h5, h6, [role="note"], [role="status"]'));
}

function hasExplicitName(el) {
  return Boolean(
    cleanLabel(labelledByText(el)) ||
    cleanLabel(el.getAttribute('aria-label')) ||
    labelsOf(el).some((label) => !hidden(label) && cleanLabel(textWithoutControls(label))),
  );
}

function nearbyCandidates(el, env) {
  const controlRect = elementRect(el, env);
  const candidates = new Map();
  const requiredMarkers = [];
  let branch = el;

  for (let depth = 0; depth < 5 && branch.parentElement; depth++) {
    const parent = branch.parentElement;
    for (const sibling of parent.children) {
      if (sibling === branch || hidden(sibling) || sibling.matches(CONTROLS) || sibling.querySelector(CONTROLS))
        continue;
      const raw = textWithoutControls(sibling);
      if (/^\s*\*+\s*$/.test(raw)) {
        const markerRect = elementRect(sibling, env);
        requiredMarkers.push({
          depth,
          distance: controlRect && markerRect ? visualDistance(controlRect, markerRect) : Infinity,
        });
        continue;
      }
      const text = cleanLabel(raw, 512);
      if (!text || !isTextCandidate(sibling)) continue;
      const siblingIndex = [...parent.children].indexOf(sibling);
      const controlBranches = [...parent.children].filter((child) => {
        const controls = child.matches(CONTROLS) ? [child] : [...child.querySelectorAll(CONTROLS)];
        return controls.some((control) => !hasExplicitName(control));
      });
      const nearestControls = controlBranches.filter((child) =>
        Math.abs([...parent.children].indexOf(child) - siblingIndex) ===
          Math.min(...controlBranches.map((control) =>
            Math.abs([...parent.children].indexOf(control) - siblingIndex),
          )),
      );
      if (nearestControls.length && (!nearestControls.includes(branch) || nearestControls.length > 1))
        continue;
      const candidateRect = elementRect(sibling, env);
      const distance = controlRect && candidateRect
        ? visualDistance(controlRect, candidateRect)
        : Infinity;
      const existing = candidates.get(sibling);
      if (!existing || depth < existing.depth || (depth === existing.depth && distance < existing.distance))
        candidates.set(sibling, {
          element: sibling,
          raw,
          text,
          depth,
          distance,
          siblingDistance: Math.abs(siblingIndex - [...parent.children].indexOf(branch)),
          structured: hasStructuredText(sibling),
        });
    }
    branch = parent;
    if (parent === el.ownerDocument.body || parent.matches("form, main, article, [role='main']"))
      break;
  }

  return {
    candidates: [...candidates.values()].sort((a, b) =>
      a.depth - b.depth || a.distance - b.distance || a.siblingDistance - b.siblingDistance,
    ),
    requiredMarkers,
  };
}

const hit = (text, source, guessed, confidence) => ({
  text,
  source,
  guessed,
  confidence,
});

// Names use page-authored semantics first and only weak structural hints last.
export function resolveLabelInfo(el, env) {
  const lb = cleanLabel(labelledByText(el));
  if (lb) return { label: hit(lb, "aria-labelledby", false, "high"), candidates: [] };

  const al = cleanLabel(el.getAttribute("aria-label"));
  if (al) return { label: hit(al, "aria-label", false, "high"), candidates: [] };

  const role = (el.getAttribute("role") || "").toLowerCase();
  if (["checkbox", "radio", "switch"].includes(role)) {
    const content = cleanLabel(textWithoutControls(el), 512);
    if (content) return { label: hit(content, "widget-content", false, "medium"), candidates: [] };
  }

  const fromLabel = cleanLabel(
    labelsOf(el).filter((label) => !hidden(label)).map(textWithoutControls).join(" "),
  );
  if (fromLabel) return { label: hit(fromLabel, "label", false, "high"), candidates: [] };

  const nearby = nearbyCandidates(el, env);
  if (nearby.candidates.length) {
    const best = nearby.candidates[0];
    const sameDepth = nearby.candidates.filter((candidate) => candidate.depth === best.depth);
    const geometricTie = sameDepth.every((candidate) =>
      candidate.distance === Infinity || candidate.distance - best.distance < 8,
    );
    const structuralTie = geometricTie && sameDepth.every((candidate) => candidate.structured)
      ? sameDepth.filter((candidate) => candidate.siblingDistance === best.siblingDistance)
      : sameDepth;
    const tied = geometricTie ? structuralTie : sameDepth.filter((candidate) =>
      candidate.distance - best.distance < 8,
    );
    if (tied.length === 1) {
      const label = hit(best.text, best.depth === 0 ? "adjacent" : "nearby-text", true,
        best.depth === 0 ? "low" : best.distance === Infinity ? "low" : "medium");
      const markersAtDepth = nearby.requiredMarkers.filter((marker) => marker.depth === best.depth);
      const closeMarkers = markersAtDepth.filter((marker) =>
        marker.distance === Infinity ? markersAtDepth.length === 1 : marker.distance <= 80,
      );
      if (/\*/.test(best.raw) || closeMarkers.length === 1)
        label.requiredHint = { value: true, source: "visible-marker" };
      return { label, candidates: [] };
    }
    const title = cleanLabel(el.getAttribute("title"));
    const ph = cleanLabel(el.getAttribute("placeholder"));
    const ac = autocompleteToken(el);
    const grouped = ["radio", "checkbox"].includes(el.type) ||
      ["radio", "checkbox", "switch"].includes(el.getAttribute("role"));
    const ident = grouped ? el.id : el.getAttribute("name") || el.id;
    const fallback = title
      ? hit(title, "title", true, "low")
      : ph && !looksLikeExample(ph)
        ? hit(ph, "placeholder", false, "medium")
        : ac
          ? hit(humanizeIdentifier(ac), "autocomplete", false, "medium")
          : isMeaningfulIdentifier(ident)
            ? hit(humanizeIdentifier(ident), "identifier", true, "low")
            : null;
    const candidates = tied
      .slice()
      .sort((a, b) => a.element.compareDocumentPosition(b.element) & 4 ? -1 : 1)
      .map((candidate) => candidate.text);
    return { label: fallback, candidates };
  }

  const title = cleanLabel(el.getAttribute("title"));
  if (title) return { label: hit(title, "title", true, "low"), candidates: [] };

  const ph = cleanLabel(el.getAttribute("placeholder"));
  if (ph && !looksLikeExample(ph))
    return { label: hit(ph, "placeholder", false, "medium"), candidates: [] };

  const ac = autocompleteToken(el);
  if (ac) return { label: hit(humanizeIdentifier(ac), "autocomplete", false, "medium"), candidates: [] };

  const grouped = ["radio", "checkbox"].includes(el.type) ||
    ["radio", "checkbox", "switch"].includes(el.getAttribute("role"));
  const ident = grouped ? el.id : el.getAttribute("name") || el.id;
  if (isMeaningfulIdentifier(ident))
    return { label: hit(humanizeIdentifier(ident), "identifier", true, "low"), candidates: [] };

  return { label: null, candidates: [] };
}

export function resolveLabel(el, env) {
  return resolveLabelInfo(el, env).label;
}

// Group question for radios/checkboxes ("Gender" above "Male"/"Female").
export function questionOf(el) {
  const group = el.closest('fieldset, [role="radiogroup"], [role="group"]');
  if (group?.localName === "fieldset") {
    const legend = [...group.children].find((c) => c.tagName === "LEGEND");
    if (legend) return cleanLabel(textWithoutControls(legend));
  } else if (group) {
    const a = cleanLabel(group.getAttribute("aria-label"));
    if (a) return a;
    const by = cleanLabel(labelledByText(group));
    if (by) return by;
  }
  if (el.type === "radio" && el.name) {
    const peers = [...el.ownerDocument.querySelectorAll('input[type="radio"]')]
      .filter((radio) => radio.name === el.name && radio.form === el.form);
    const parent = peers[0]?.closest("fieldset, [role='radiogroup'], [role='group']");
    if (parent && parent !== group) {
      const legend = parent.localName === "fieldset" &&
        [...parent.children].find((child) => child.tagName === "LEGEND");
      if (legend) return cleanLabel(textWithoutControls(legend));
      const ariaName = cleanLabel(parent.getAttribute("aria-label")) || cleanLabel(labelledByText(parent));
      if (ariaName) return ariaName;
    }
  }
  return "";
}

// Nearest heading above the field: fieldset legend, else a heading sibling
// (or a control-free wrapper holding one) walking up at most 6 levels.
export function sectionOf(el) {
  const fs = el.closest("fieldset");
  const legend = fs && [...fs.children].find((c) => c.tagName === "LEGEND");
  if (legend) return cleanLabel(textWithoutControls(legend));
  const HEADING = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  let node = el;
  for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
    let sib = node.previousElementSibling;
    for (
      let hops = 0;
      sib && hops < 6;
      hops++, sib = sib.previousElementSibling
    ) {
      if (sib.matches(HEADING)) return cleanLabel(textWithoutControls(sib));
      if (!sib.querySelector(CONTROLS)) {
        const h = sib.querySelector(HEADING);
        if (h) return cleanLabel(textWithoutControls(h));
      }
    }
  }
  return "";
}
