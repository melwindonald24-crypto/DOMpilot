import { createRegistry } from './registry.js';
import { createOverlay } from './overlay.js';
import { buildSnapshot, locateField, PerceptionPrivacyError } from './snapshot.js';

export { createRegistry, createOverlay, buildSnapshot, locateField, PerceptionPrivacyError };

// Wiring only. Top frame, no shadow DOM (v1).
// `sanitizeText` must be synchronous; throwing aborts the snapshot.
export function initPerception({ sanitizeText }) {
  if (window.top !== window) return null;
  const registry = createRegistry();
  const overlay = createOverlay(document);
  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (msg?.type === 'dompilot:snapshot') {
      try {
        send({ ok: true, snapshot: buildSnapshot({ registry, sanitizeText }) });
      } catch (e) {
        send({ ok: false, error: e.name, failClosed: e instanceof PerceptionPrivacyError });
      }
    } else if (msg?.type === 'dompilot:overlay') {
      if (msg.action === 'hide') {
        overlay.hide();
        send({ ok: true, hidden: true });
      } else if (
        msg.action === 'show' &&
        (msg.refs === undefined || (Array.isArray(msg.refs) && msg.refs.every((ref) => typeof ref === 'string')))
      ) {
        send({ ok: true, placed: overlay.show(registry, { refs: msg.refs }) });
      } else {
        send({ ok: false, error: 'invalid-overlay-request' });
      }
    }
    return false;
  });
  return registry; // Fill layer imports this to call locateField
}
