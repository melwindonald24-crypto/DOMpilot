# DOMpilot Codebase Documentation

## 1. Scope

This project is now a minimal Chrome extension focused on one core feature:

- inspect the active page
- build a value-free DOM snapshot
- redact sensitive content locally
- send sanitized data to a backend
- execute the returned action in the page
- repeat until the task stops or completes

This document reflects the current trimmed-down codebase, not the older larger prototype.

---

## 2. Runtime architecture

The extension runs across a few browser contexts:

### 2.1 Side panel
Files:
- [sidepanel/sidepanel.html](C:/Users/melwi/OneDrive/Desktop/DOMpilot/sidepanel/sidepanel.html)
- [sidepanel/sidepanel.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/sidepanel/sidepanel.js)
- [sidepanel/sidepanel.css](C:/Users/melwi/OneDrive/Desktop/DOMpilot/sidepanel/sidepanel.css)

Purpose:
- minimal task UI
- Start/stop a task
- show current task status

### 2.2 Background service worker
Files:
- [src/background.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/background.js)
- [src/loop.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/loop.js)
- [src/router.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/router.js)
- [src/bridge.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/bridge.js)
- [src/capture.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/capture.js)
- [src/local-values.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/local-values.js)

Purpose:
- manage task state in `chrome.storage.session`
- decide whether to do `/analyze` or `/act`
- coordinate page capture, backend calls, and execution
- keep the task lifecycle simple and deterministic

### 2.3 Content script
File:
- [src/content.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/content.js)

Purpose:
- inspect visible DOM elements
- produce a structured snapshot of form controls
- perform page actions such as click/fill/scroll

### 2.4 Offscreen document
Files:
- [src/offscreen.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/offscreen.js)
- [src/offscreen.html](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/offscreen.html)

Purpose:
- run local sanitization work away from the page context
- redact a screenshot before it is sent anywhere

---

## 3. Core loop

The main loop is implemented in [src/loop.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/loop.js).

The loop is intentionally simple:

1. read task state from storage
2. inspect the active tab
3. compute the current DOM fingerprint
4. ask the router whether to analyze or act
5. if `analyze`, capture a sanitized screenshot and call `/analyze`
6. if `act`, build a value-free DOM summary and call `/act`
7. execute the returned action in the page
8. update state and schedule the next iteration
9. stop when the task ends, errors, or reaches the max iteration cap

This is not a multistage planning pipeline. It is a single repeatable loop with state persisted to browser storage.

---

## 4. Important modules

### 4.1 [src/background.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/background.js)
This is the extension message bridge.

It exposes minimal commands:
- `captureAndSanitize`
- `getLastCapture`
- `getCaptureHistory`
- `getVaultProfile`
- `updateVaultProfile`
- `startTask`
- `stopTask`
- `getTaskState`

It routes UI and extension calls to the real activity in the loop and storage layer.

### 4.2 [src/loop.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/loop.js)
This is the main orchestration file.

Key exported functions:
- `startTask({ goal, maxIterations })`
- `stopTask()`
- `getTaskStateSnapshot()`

Key runtime behaviors:
- starts with a router state built from the active tab id
- saves state to `chrome.storage.session`
- reads and writes task state each pass
- calls `captureAndSanitize()` when routing says analyze
- calls `callAct()` when routing says act
- executes returned actions using [src/executor.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/executor.js)
- stops once the task is done or max iterations are reached

### 4.3 [src/router.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/router.js)
This module is the decision function.

It contains:
- `computeControlFingerprint()`
- `createInitialRouterState()`
- `computeSignals()`
- `decideRoute()`
- `applyAnalyzeOutcome()`
- `applyActionOutcome()`

The route decision is deterministic and based on:
- whether the page was analyzed before
- whether the DOM changed
- whether the last action failed
- whether the page is in a safe refresh window

### 4.4 [src/bridge.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/bridge.js)
This is the backend client.

It sends JSON to the backend:
- `callAnalyze(...)` for `/analyze`
- `callAct(...)` for `/act`

It defaults to `http://localhost:3000` unless `piiGuardServerUrl` is set in Chrome storage.

### 4.5 [src/capture.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/capture.js)
This handles screen capture and sanitization.

Key functions:
- `ensureOffscreenDocument()`
- `getUiSnapshot(tab)`
- `getActiveHttpTab()`
- `captureAndSanitize(tab)`
- `getLastCapture()`
- `getCaptureHistory()`

Step flow:
1. get the active tab
2. snapshot the current DOM from the content script
3. capture the visible tab image
4. send screenshot + snapshot to the offscreen document
5. return a sanitized screenshot plus redaction metadata

### 4.6 [src/content.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/content.js)
This is the page-inspection and action execution layer.

It provides logic to:
- enumerate visible elements
- read labels, names, placeholders, and dimensions
- build a stable snapshot structure
- respond to actions like click/fill/scroll

This is where the extension reads the page and carries out the actual browser-side action after the backend decides what to do.

### 4.7 [src/dom-serializer.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/dom-serializer.js)
This turns the page snapshot into a value-free DOM summary used for backend communication.

Key functions:
- `buildDomNodes(snapshot)`
- `computeHasVisualOnlyContent(snapshot)`
- `buildPageMetadata(...)`

Important rule:
- the backend sees structure, not raw values
- value-bearing fields are stripped before data is sent

### 4.8 [src/executor.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/executor.js)
This executes the actions returned by the backend.

Supported action types:
- `fill`
- `click`
- `scroll`
- `navigate`

Behavior:
- `fill` resolves a `local:<key>` value from the session vault
- `click` sends a click message to the content script
- `scroll` sends a page scroll instruction
- `navigate` calls the browser’s forward/back navigation

### 4.9 [src/local-values.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/local-values.js)
This is the session vault for values the extension may need to fill into a form.

It stores values such as:
- `name`
- `email`
- `phone`
- `address`
- `aadhaarNumber`
- `panNumber`

Important rule:
- values live in `chrome.storage.session`, not long-lived storage
- they are cleared when the task ends

### 4.10 [src/ocr.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/ocr.js)
This is the OCR and redaction path.

It creates a local Tesseract worker and uses OCR to detect sensitive values in the screenshot.

Key exported functions:
- `recognizeText(canvas)`
- `extractOcrMasks(data)`
- `runOcrPass(canvas, cropRects)`

This is the key privacy feature: OCR is done locally and the redaction mask is applied before any network request is sent.

### 4.11 [src/offscreen.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/offscreen.js)
This runs local sanitization work.

It:
- converts incoming screenshot data into a canvas
- applies redaction to DOM-based and OCR-based matches
- produces a sanitized image plus a mask list

---

## 5. Privacy model

The core guarantee is: do not send raw form data or raw screenshots to the backend.

The actual flow is:

1. content script inspects the page
2. DOM serializer removes values and sends only structure
3. screenshot is captured
4. OCR and regex detection redact sensitive regions locally
5. only sanitized result is sent to backend
6. backend returns a single action object
7. action is executed locally in the page

This reduces leak risk and keeps the extension privacy-first.

---

## 6. Current project constraints

The project has intentionally been stripped down to the essential behavior. The current codebase does not include:

- action rewrite pipeline
- action guard system
- debug log export system
- document-reader extraction flow
- face detection layer
- heavy UI workflow
- acceptance-test harness

Those features were removed to keep the project focused on the central functionality only.

---

## 7. Minimal file map

Core runtime files:
- [src/background.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/background.js)
- [src/loop.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/loop.js)
- [src/router.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/router.js)
- [src/bridge.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/bridge.js)
- [src/capture.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/capture.js)
- [src/content.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/content.js)
- [src/dom-serializer.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/dom-serializer.js)
- [src/executor.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/executor.js)
- [src/local-values.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/local-values.js)
- [src/ocr.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/ocr.js)
- [src/offscreen.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/offscreen.js)
- [src/pii/detector.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/pii/detector.js)
- [src/pii/anonymizer.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/pii/anonymizer.js)
- [src/pii/validators.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/pii/validators.js)
- [src/pii/regex-patterns.js](C:/Users/melwi/OneDrive/Desktop/DOMpilot/src/pii/regex-patterns.js)

UI file:
- [sidepanel/sidepanel.html](C:/Users/melwi/OneDrive/Desktop/DOMpilot/sidepanel/sidepanel.html)

Manifest:
- [manifest.json](C:/Users/melwi/OneDrive/Desktop/DOMpilot/manifest.json)

---

## 8. Summary

The current DOMpilot codebase is a compact, privacy-oriented automation loop for browser forms. It is intentionally smaller than the earlier prototype, but it still captures the essential architecture:

- inspect page structure
- sanitize locally
- send minimal data
- do one backend action
- execute it in the browser
- repeat until the task ends

That is the real core of the extension today.
