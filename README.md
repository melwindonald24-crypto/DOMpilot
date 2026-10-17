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
