export const NATIVE = "input, select, textarea";
const WIDGET = [
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
export const FIELD_SELECTOR = `${NATIVE}, ${WIDGET}`;
const SKIP_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
]);
const CHROME =
  'header, nav, footer, aside, [role="search"], [role="banner"], [role="navigation"], [role="contentinfo"], [role="complementary"]';
const CHROME_ESCAPE = 'main, article, [role="main"], [role="dialog"], dialog';

// Injectable so the rules can be unit-tested without a layout engine.
export const defaultEnv = {
  isHidden(el) {
    const win = el.ownerDocument.defaultView;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return true;
      if (node.localName === "dialog" && !node.open) return true;
      const style = win.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0"
      )
        return true;
    }
    return false;
  },

  isVisible(el) {
    if (this.isHidden(el)) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },

  rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  },

  viewport(doc) {

    const w = doc.defaultView;
    return { w: w.innerWidth, h: w.innerHeight, dpr: w.devicePixelRatio || 1 };

  },

  topAt(doc, x, y) {
    return doc.elementFromPoint(x, y);
  },
};


export function collectFields(doc) {
  return [...doc.querySelectorAll(FIELD_SELECTOR)]; // DOM order
}

// Header/nav/footer/aside/search areas, unless nested in main, article or a dialog.
export function inChrome(el) {

  const c = el.closest(CHROME);
  return !!c && !c.closest(CHROME_ESCAPE);
}

const skip = (reason) => ({ ok: false, reason });

export function isDisabled(el) {
  return (
    (typeof el.matches === "function" && el.matches(":disabled")) ||
    el.getAttribute("aria-disabled") === "true" ||
    !!el.closest('[aria-disabled="true"]')
  );
}

function visibleTarget(el, type, env) {

  if (env.isVisible(el)) return el;
  if (type === "checkbox" || type === "radio" || type === "file") {
    for (const l of el.labels || []) if (env.isVisible(l)) return l;
    if (type === "file" && el.parentElement && env.isVisible(el.parentElement))
      return el.parentElement;
  }
  return null;
}

// Returns {ok:true, coverage} or {ok:false, reason}.
// coverage 'unverified' = centre is off-screen; re-check after scrolling at Fill.
export function evaluateField(el, env = defaultEnv, doc = el.ownerDocument) {
  const type = el.tagName === "INPUT"
    ? (el.type || "text").toLowerCase()
    : el.getAttribute("role") ||
      (el.getAttribute("aria-haspopup") === "listbox" ? "combobox" : el.localName);
  if (SKIP_TYPES.has(type))
    return skip("type");

  if (inChrome(el)) return skip("chrome");

  if (el.getAttribute("tabindex") === "-1" && el.closest('[aria-hidden="true"]'))
    return skip("honeypot");

  const target = visibleTarget(el, type, env);
  if (!target) return skip("hidden");

  const disabled = isDisabled(el);
  const readonly = el.readOnly === true || el.getAttribute("aria-readonly") === "true";
  const r = env.rectOf(target);
  const vp = env.viewport(doc);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (cx < 0 || cy < 0 || cx >= vp.w || cy >= vp.h)
    return { ok: true, coverage: "unverified", disabled, readonly };

  const top = env.topAt(doc, cx, cy);
  if (!top) return { ok: true, coverage: "unverified", disabled, readonly };

  const l = top.closest("label");

  const ownLabel = !!l && [...(el.labels || [])].includes(l);
  if (top === target || target.contains(top) || el.contains(top) || ownLabel)
    return { ok: true, coverage: "clear", disabled, readonly };
  return skip("covered");
}
