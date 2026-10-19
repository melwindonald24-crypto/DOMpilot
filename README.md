# DOMpilot

A minimal Chrome extension for a simple form-automation loop with on-device PII redaction.

## Core feature

- Inspect the current page.
- Serialize a value-free DOM summary.
- Redact sensitive text and screenshots locally.
- Send only sanitized data to the backend.
- Execute a single backend action on the page.
- Repeat until the task is finished or stopped.

## Minimal file set

The runtime focuses on the essential flow:

- `src/background.js` — extension message bridge
- `src/loop.js` — task loop and state machine
- `src/router.js` — route decisions
- `src/bridge.js` — backend HTTP client
- `src/content.js` — DOM inspection and in-page actions
- `src/dom-serializer.js` — value-free DOM format
- `src/executor.js` — action execution
- `src/capture.js` — screenshot capture and sanitization
- `src/ocr.js` — OCR masking pipeline
- `src/local-values.js` — vault for local values
- `src/pii/*` — PII detection and validation

Everything else in the project was removed as non-essential bloat for the core feature.

## DOM perception prototype

`src2/` contains a standalone Layer 1 perception prototype; it is not wired into
the extension runtime in `src/`. It builds a value-free tree from standard
top-frame light-DOM controls, including common ARIA and contenteditable widgets,
reports iframe, open-shadow-root, and canvas boundaries as incomplete coverage,
and rejects field references after a new snapshot so stale actions cannot target
newly indexed controls. It does not guarantee coverage of arbitrary
site-specific widgets.

Run its tests from `src2/` with `npm test`. `perception.acceptance.test.js`
checks generic native/ARIA forms, value privacy, hidden content, action labels,
stale references, ambiguous nearby labels, visible required markers, context
across generic wrappers, and nested unsupported boundaries; `perception.test.js`
contains focused behavior tests plus the Sarathi fixture regression; and
`overlay.test.js` covers the optional visual reference overlay. Nearby text is
treated as inferred evidence, competing candidates are retained, and a visible
required marker is kept distinct from native required state.

The top-frame listener accepts `{ type: "dompilot:overlay", action: "show",
refs?: [...] }` or `{ type: "dompilot:overlay", action: "hide" }`. The overlay
uses a closed shadow root and is separate from the snapshot output. The jsdom
tests validate DOM semantics, not browser layout; use a real browser for
visibility acceptance checks before integrating this prototype into the
extension.
