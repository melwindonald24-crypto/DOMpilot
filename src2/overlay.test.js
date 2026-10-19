// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createOverlay } from './overlay.js';
import { createRegistry } from './registry.js';
import { buildSnapshot } from './snapshot.js';

const setRect = (el, rect = { x: 12, y: 24, width: 120, height: 28 }) => {
  el.getBoundingClientRect = () => ({
    ...rect,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  });
};

describe('reference overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows only requested known refs and removes the overlay when hidden', () => {
    document.body.innerHTML = '<input aria-label="First"><input aria-label="Second">';
    const [first, second] = document.querySelectorAll('input');
    setRect(first);
    setRect(second, { x: 150, y: 24, width: 120, height: 28 });
    const registry = createRegistry();
    const firstRef = registry.add(first, {});
    const secondRef = registry.add(second, {});
    const overlay = createOverlay(document);

    expect(overlay.show(registry, { refs: [secondRef, 'stale-ref'] })).toEqual([
      { ref: secondRef, number: 2 },
    ]);
    const host = document.querySelector('[data-dompilot-overlay]');
    expect(host).not.toBeNull();
    expect(host.textContent).toBe('');

    expect(overlay.show(registry, { refs: [firstRef] })).toEqual([
      { ref: firstRef, number: 1 },
    ]);
    overlay.hide();
    expect(document.querySelector('[data-dompilot-overlay]')).toBeNull();
  });

  it('hides boxes for disconnected or CSS-hidden fields', () => {
    document.body.innerHTML = '<div style="opacity: 0"><input aria-label="Hidden"></div><input aria-label="Removed">';
    const [hidden, removed] = document.querySelectorAll('input');
    setRect(hidden);
    setRect(removed);
    const registry = createRegistry();
    registry.add(hidden, {});
    registry.add(removed, {});
    const overlay = createOverlay(document);
    const originalAttachShadow = HTMLElement.prototype.attachShadow;
    let shadow;
    HTMLElement.prototype.attachShadow = function (options) {
      shadow = originalAttachShadow.call(this, options);
      return shadow;
    };

    try {
      removed.remove();
      overlay.show(registry);
      expect(shadow.querySelectorAll('div')).toHaveLength(2);
      expect([...shadow.querySelectorAll('div')].map((box) => box.style.display)).toEqual([
        'none',
        'none',
      ]);
      overlay.hide();
    } finally {
      HTMLElement.prototype.attachShadow = originalAttachShadow;
    }
  });

  it('keeps the closed overlay outside the public DOM snapshot', () => {
    document.body.innerHTML = '<label for="name">Name</label><input id="name">';
    const input = document.querySelector('input');
    setRect(input);
    const registry = createRegistry();
    const overlay = createOverlay(document);
    const initial = buildSnapshot({
      doc: document,
      registry,
      sanitizeText: (text) => text,
      env: {
        isHidden: () => false,
        isVisible: () => true,
        rectOf: () => ({ x: 12, y: 24, w: 120, h: 28 }),
        viewport: () => ({ w: 800, h: 600, dpr: 1 }),
        topAt: () => input,
      },
    });

    overlay.show(registry);
    const withOverlay = buildSnapshot({
      doc: document,
      registry,
      sanitizeText: (text) => text,
      env: {
        isHidden: () => false,
        isVisible: () => true,
        rectOf: () => ({ x: 12, y: 24, w: 120, h: 28 }),
        viewport: () => ({ w: 800, h: 600, dpr: 1 }),
        topAt: () => input,
      },
    });

    const labels = (tree) => tree.flatMap((node) =>
      node.type === 'field' ? [node.label] : node.children ? labels(node.children) : [],
    );
    expect(labels(withOverlay.tree)).toEqual(labels(initial.tree));
    expect(withOverlay.completeness).toEqual(initial.completeness);
    overlay.hide();
  });
});
