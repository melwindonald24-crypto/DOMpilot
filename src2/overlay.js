const PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#008080",
  "#f032e6",
  "#800000",
  "#808000",
  "#000075",
];

function refNumber(ref) {
  const match = /^f\d+-(\d+)$/.exec(ref);
  return match ? Number(match[1]) : null;
}

export function createOverlay(doc = document) {
  const win = doc.defaultView;
  let host = null;
  let boxes = [];
  let raf = 0;

  const place = () => {
    raf = 0;
    for (const { el, box } of boxes) {
      const rect = el.getBoundingClientRect();
      let visible = el.isConnected && rect.width > 0 && rect.height > 0;
      for (let node = el; visible && node?.nodeType === 1; node = node.parentElement) {
        const style = win.getComputedStyle(node);
        if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true" ||
            style.display === "none" || style.visibility !== "visible" || style.opacity === "0") {
          visible = false;
        }
      }
      box.style.display = visible ? "block" : "none";
      if (visible) {
        box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      }
    }
  };

  const schedule = () => {
    if (raf) return;
    if (win.requestAnimationFrame) raf = win.requestAnimationFrame(place);
    else place();
  };

  function hide() {
    if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    raf = 0;
    win.removeEventListener("scroll", schedule, true);
    win.removeEventListener("resize", schedule);
    host?.remove();
    host = null;
    boxes = [];
  }

  function show(registry, { refs } = {}) {
    hide();
    const wanted = refs ? new Set(refs) : null;
    host = doc.createElement("div");
    host.setAttribute("data-dompilot-overlay", "");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
    const placed = [];

    for (const [ref, el] of registry.entries()) {
      if (wanted && !wanted.has(ref)) continue;
      const number = refNumber(ref);
      if (number === null) continue;
      const color = PALETTE[(number - 1) % PALETTE.length];
      const box = doc.createElement("div");
      box.style.cssText =
        `position:absolute;top:0;left:0;box-sizing:border-box;border:2px solid ${color};background:${color}1A;`;
      const tag = doc.createElement("span");
      tag.textContent = String(number);
      tag.style.cssText =
        `position:absolute;top:0;left:-2px;transform:translateY(-100%);background:${color};color:#fff;font:600 11px/1 system-ui,sans-serif;padding:2px 4px;border-radius:3px 3px 0 0;`;
      box.append(tag);
      shadow.append(box);
      boxes.push({ el, box });
      placed.push({ ref, number });
    }

    doc.documentElement.append(host);
    place();
    win.addEventListener("scroll", schedule, true);
    win.addEventListener("resize", schedule);
    return placed;
  }

  return { show, hide };
}
