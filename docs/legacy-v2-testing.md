# Archived v2 verification report — 2026-10-03

Historical report supplied with GPT-Pro's v2. Its referenced test suite and source
bundle are not present here; these counts are not claims about the current app.
See [current verification](../TESTING.md) for reproducible checks in this workspace.

## Executed

**50 Node.js assertions** in `tests/v2.test.cjs`: English text/data, backward-compatible v1 JSON, all 32 stickers, duration parsing, rejected negations and questions, proposal composition and confirmation, locked/visited stops, stale proposals, undo, compressed Unicode transfers, privacy exclusion, malformed imports, QR/AVG generation, guided launch flow and actual Alexa JSON request/response handling.

**27 Chromium UI checks** in `tests/browser_v2.py`: English first load and labels, all sticker decodes, day tabs, two successive suggestions, launch/creation/review/handoff, actual photo decoding/resizing, three-sticker cap and category filters, unsaved cancellation, quota failure/retry, HTML export/reopen and JSON import. Widths 320, 360, 390, 600, 760, 768, 1024 and 1440 px; no measured horizontal body/dialog overflow. No uncaught page errors or automatic HTTP requests in those runs.

**7 QR matrix reference comparisons**, covering payloads of 8, 64, 230, 440, 900, 1400 and 2000 bytes, use the installed python-qrcode reference with byte mode, M correction and mask 0. Every module matches. Run `python tests/qr_reference.py` to reproduce.

Screenshots in `previews/` are actual HTML rendered in Chromium. They are not image-generator mockups. New sticker source artwork is generated separately and extracted into individual WebP files.

## What these checks do not establish

The browser is driven using `page.set_content`. A clearly isolated, in-memory localStorage adapter is used because that page does not have a normal deployed origin. IndexedDB, actual browser persistence across real-device restarts, OS download placement, iPhone/Android image orientation and Safari input behavior are not thereby verified. The adapter is in tests only, not in the app.

Alexa tests use synthetic event envelopes and an injected fake persistence store. They verify our source's outputs and data changes, not live NLU, certification, APL rendering, AWS SDK installation, DynamoDB connectivity, skill permissions or Echo audio. The QR matrix is validated, but a physical phone scan from an Echo display is not tested. The optional voice model has not been built in Amazon's console.

No tests claim a public hosting deployment, an Alexa+ integration, a real wake-word listener, a working transfer to an actual phone, or legal/IP clearance.

## Reproduce

```sh
python build.py
node tests/v2.test.cjs
python tests/browser_v2.py
python tests/qr_reference.py
```

Node is needed for pure modules; Python, Playwright, Chromium and Pillow are used for UI tests. Python qrcode is used for independent QR comparison. Set `CHROMIUM` if its executable is not `/usr/bin/chromium`.
