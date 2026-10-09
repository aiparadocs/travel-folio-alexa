# Verification record

Verified locally on 2026-10-04 and again on 2026-10-09 (kippu & stamp redesign), Windows,
Node.js 22.18.0, Chromium through Playwright.
These results cover this integrated app, not the older standalone bundle's reports.

## Automated tests

From this directory run `npm ci`, then `npm test`.

**98 tests passed, 0 failed** (2026-10-09). This includes the original 38 checks,
2 Bedrock request-shape checks added after the first live run (tool-schema keys, today's date),
10 voice API, 18 voice-controller, 5 returning-visit, 5 MCP Apps, 5 memory-sharing,
10 stamp (`test/stamps.test.js`) and 5 phone-design (`test/phone-design.test.js`) checks. No cloud credentials
or model charges are required.

- 5 MCP Apps tests (`test/apps.test.js`): `preview_trip` shows a pending trip without saving it, tool `_meta.ui.resourceUri` links, listed and
  readable `ui://` view with the MCP Apps MIME type and empty CSP allowlist, a bundle with
  no external requests, the real view script's `ui/initialize` handshake, Alexa+ root zoom,
  proposal/weather rendering and rejection of messages not from the host, and the HTTP host
  (latest card in state, resource endpoint, sandbox `frame-ancestors`, other pages `DENY`).
- 5 memory-sharing tests (`test/share.test.js`): pairing token in the handoff link,
  unpaired and malformed uploads refused, empty memories dropped, private notes never
  stored, greeting on arrival, "yes" shows the slideshow through MCP, Japanese voice reply,
  persistence across restart, validation caps, and no image data returned to a model.
- 5 returning-visit tests (`test/memory.test.js`): a saved plan survives a real server
  restart and is re-read through MCP; one proactive greeting per return; before, during
  and after the trip wording; "yes" to the offer only prepares a proposal; "no" and a
  later "yes" change nothing; other browsers cannot see it; damaged files stay untouched;
  nothing is written without a data directory.

- 10 backend tests: actual HTTP/MCP journey, isolated sessions, origin/auth/input
  rejection, concurrent confirmation, bounded guided/Bedrock tool execution,
  preservation of multi-day itineraries, expired proposals, recoverable cloud
  failures, occupied ports and clean restart.
- 23 domain/MCP/weather/handoff tests: city/day/pace combinations, non-overlapping
  schedules, fixed/visited stops, immutable previews, expiry/version checks, Undo,
  atomic persistence, real MCP protocol flow, Unicode, QR capacity and privacy,
  unavailable/partial forecasts and preceding-hour weather alignment.
- 5 phone integration tests: inline JavaScript parsing, the actual phone decoder
  against server handoffs, private-field exclusion, Unicode, malformed links and
  the 32 embedded sticker assets.
- 10 voice API tests: Japanese/English commands, exact proposal matching, missing,
  stale and expired references, unqualified human approval, model confirmation
  rejection, spoken handoff and physical-LAN address preference.
- 18 voice-controller tests: actual `public/voice.js` in a Node VM with simulated
  browser speech APIs and deterministic clocks. Duplicate/interim recognition,
  no listening during speech, successful-read-only confirmation, late callbacks
  after Stop, visibility/pagehide, finite silence retry, watchdogs, permission and
  service failures, constructor exceptions and QR completion are covered.

Bedrock tests inject model responses. They verify the adapter and confirmation
boundaries, not AWS permissions, model availability or answer quality.

## Browser checks

2026-10-06: memory sharing was exercised end to end in headless Chromium: home plan →
QR link with pairing token → phone import → Kinkaku-ji photo, caption and sticker →
Save & take → Show memories on Echo Show (confirmation) → home greeting → slideshow card
on the Echo Show view. No page errors. The demo video recording repeats this flow.

2026-10-06: the Echo Show view was rendered in headless Chromium 134 for an itinerary,
weather risk, a proposed indoor swap and an applied change, through the real sandbox proxy
(`localhost` ↔ `127.0.0.1`). Screenshots were inspected; no console errors after fixing a
`frame-ancestors` source. The Alexa+ Local Inspector is not publicly available, so the
view has not been checked against Alexa's own rules or devices.

2026-10-06: the returning-visit flow was checked manually in Chromium after a real
server restart: restored itinerary, welcome-back message, suggestion button, resulting
indoor proposal, no console errors. The Playwright `qa/` scripts below were not re-run
for this change.

The `qa/browser-*.js` files each contain an async Playwright function accepting
`page`. Start the app, open its origin in Playwright, then execute each file via
the browser tool's `browser_run_code_unsafe` `filename` argument. The functions
create isolated browser contexts and leave existing user journals untouched.
They are not part of `npm test` and are not directly executable Node scripts.

| File | Passed | Scope |
| --- | ---: | --- |
| `qa/browser-journey.js` | 26 | Create → confirm → sample rain → preview → apply → Undo; decline; coffee stop; day selection; reload; real handoff; photo/caption/sticker; HTML export and reopen |
| `qa/browser-phone.js` | 20 | Real IndexedDB persistence, responsive layout, failed-save recovery/export, newest rescue selection, notes-only recovery, unreadable-data protection, stale-tab conflict protection |
| `qa/browser-states.js` | 8 | Initial connection failure/retry, incomplete-weather labels, cloud failure after preparing a proposal, no automatic mutation retry |
| `qa/browser-voice.js` | 23 | Japanese/English voice events → real HTTP/MCP → confirmation → weather → cancellation → LAN QR; no microphone before Start, no recognition/read-aloud overlap, interrupted-reading protection |
| `qa/browser-memory-layout.js` | 48 | Square/portrait/panoramic photos keep their shape on screen, in the editor, in print and in standalone export; distinct memories paper; no overflow at 1280/390/320px |
| `qa/browser-print.js` | 26 | Itinerary/memories/combined preview, day selection, decoded photos, native print/cancel, unchanged journal/storage, portable export, complete long text and multiline continuation, measured page bounds |

The home and phone pages fit 1440, 768, 390 and 320 CSS-pixel widths. The conversation
entry is visible at 1280×900. Desktop and mobile screenshots were visually
inspected; `qa/home-desktop.png` and `qa/home-mobile.png` show the home page.
The full journey produced no uncaught JavaScript errors. The inspected home page
had no browser console errors or warnings.

The larger-type home redesign was checked at 1280, 768, 390 and 320 pixels,
including an empty page and a confirmed itinerary. The journey, failure-state
and voice browser checks passed again after the redesign. Text entry and manual
planning are collapsed initially; opening either stops an active voice session.

The phone journal uses the same larger typography and rounded cards. After its
redesign, 66 Node tests, 20 phone browser checks and the 26-check full journey passed.
Itinerary, memories, editor/stickers, adjustment sheet and save dialog were inspected
at desktop and mobile widths, including 320px. Mobile adjustment, Undo, typed
proposal/cancel and memory editing were also exercised with no console warnings or
uncaught errors. Screenshots are in `qa/phone-redesign-*.png`; styles remain inline
for standalone HTML exports, and screen-only styles preserve print rules.

The dedicated A4 print layout was then verified in actual Chromium PDF output.
A two-day, eight-stop fixture with four illustrated photo placeholders produced
one page in each mode (itinerary, memories, combined). A long 22-stop fixture
produced 14 pages, matching its preview. PDFs were counted with pypdf and selected
pages rendered with Poppler for visual inspection; no clipped text or missing
images were observed. Mobile preview fits 390px. The 26 print checks also cover
60-line notes and 100-line captions without dropping content. Printer hardware
and paper/scale overrides in the native print dialog are outside these checks.

Typography uses locally bundled Caveat handwritten headings and Nunito body text. (Superseded on 2026-10-09; see "Kippu & stamp redesign".)
Both faces loaded at 1280, 768, 390 and 320px without horizontal overflow or browser
warnings/errors. All 26 print checks passed after the font change; paper layout
waits for fonts before measuring. An exported journal loaded both embedded fonts
with every subsequent network request blocked (zero requests), and retained both
license notices. Other writing systems use device font fallbacks.

After the user's handwritten-font correction, Caveat replaced Quicksand in the
home, phone and paper layouts. Handwritten text was enlarged to retain legibility.
The four-width layout check and all 26 print browser checks passed again.

Memories now uses kraft paper on screen and on its printed sheets. The focused
`qa/browser-memory-layout.js` passed 48 checks with square, portrait and panoramic
photos at 1280, 390 and 320px: image ratios and wrapper bounds, photo editing,
print/combined/native-print pagination, and exported HTML reopening. Photo wrappers
follow intrinsic image dimensions; print preparation decodes photos before measuring.
The 26 print checks and 26-check full journey also passed. Actual Chromium PDFs for
Memories and combined mode each matched the one-page preview; Poppler renders were
visually checked. Screenshots are saved as `qa/memory-kraft-*.png`.

The subsequent texture revision replaced subtle SVG noise with an embedded,
generated kraft-paper WebP (292,012 bytes). The existing 48 memory-layout checks
passed again. Desktop/mobile and print previews were visually inspected; texture
loading is awaited before startup/printing. The embedded texture also decoded with
all external requests blocked, without generating a network request.

The senior-readability pass raises phone body/actions to 20px, most secondary
labels to 18px, memory titles to 34px and handwritten captions to 30px. Controls
and layout remain screen-scoped. An extended memory-layout fixture with four
waiting stops passed 56 checks at 1280/768/390/320px, including pale-backed waiting
rows and 52px action targets; the full journey's 26 checks passed. Itinerary
reflow, 320px forms/sticker selection and 640px layout were inspected separately;
no horizontal overflow or browser errors were observed. Checkboxes retain a
26px width even with long labels. Print and standalone preview checks remain
covered; no claim of a formal accessibility audit or user study is made.

The voice browser journey simulates recognition results and speech completion,
then uses the real app/server/MCP. It does **not** prove that microphone recognition
or audio output works on a particular device. The 25-check run used a LAN-enabled
server and verified both QR image rendering and the itinerary link. The ordinary
journey also opened that LAN link from a browser on this PC and imported it into
the journal. Physical phone scanning and firewall access remain separate checks.

The export check reads a real browser download, then serves the exported HTML
back to a fresh page and verifies its photo, Japanese caption and sticker. It does
not substitute for opening a saved `file://` document on every operating system.
Storage failures and cloud failures are deliberately injected. IndexedDB
cross-tab conflict checking is transactional; localStorage fallback protection
is best-effort because localStorage has no equivalent transaction across tabs.

## Kippu & stamp redesign (2026-10-09)

The home page, Echo Show card and host, phone journal and print sheets were restyled
(indigo/vermilion, tickets, departure board, ink stamps, light kraft memories). Element
IDs, buttons and server/MCP behaviour are unchanged.

- `npm test`: 96 passed. Browser QA (run with a small Node runner around these files):
  journey 26, states 8, voice 23, phone 20, print 26, memory-layout 48 — all passed.
- No horizontal overflow on the home page at 320–1440px or in the journal at 1280/390/320px.
- Print: the sample journal is one A4 sheet in all three modes; preview and real PDF page
  counts match.
- Measured contrast of text pairs is at least 5.2:1 (body text 12.9–16:1).
- Fonts are subsets totalling 130.8 KB; the journal file shrank from 1,032 KB to 798 KB
  (lighter 72 KB paper texture).
- `qa/browser-memory-layout.js` now measures layout boxes instead of
  `getBoundingClientRect`, because memory photos are tilted slightly on purpose; a
  deliberately stretched or letterboxed photo still fails the check.
- Screenshots: `qa/kippu-*.png` (phone screenshots use synthetic photos).

## External integration and remaining checks

- One live Open-Meteo lookup for Kyoto, 2026-10-05, returned 24 hourly readings and
  a complete assessment during development. This does not guarantee later API
  availability or forecast accuracy. The default demo uses labelled sample weather.
- One live Bedrock session, 2026-10-09: Amazon Nova 2 Lite through the Japan inference
  profile `jp.amazon.nova-2-lite-v1:0` in `ap-northeast-1`, authenticated with a short-term
  Bedrock API key held only in the server process. The first request failed until tool
  schemas were trimmed to `type`/`properties`/`required` (see FRICTION_LOG.md #6). Then:
  "Plan two easy days in Kyoto with good coffee, starting this Saturday" → create proposal
  starting 2026-10-10 (a Saturday), confirmed by button; "Will it rain on day 1?" → answered
  from `check_weather` (demo sample: Fushimi Inari Taisha at risk); a Japanese request to
  move rainy stops indoors → swap proposal (Kyoto Aquarium); "apply that change yourself" →
  proposal left pending until Apply was pressed. Replies to Japanese input stay English when
  they quote a proposal summary, which the app writes in English. Answer quality, other
  models/Regions and IAM-restricted roles were not evaluated.
- Actual phone camera QR scanning, same-Wi-Fi firewall behaviour, iPhone/Safari,
  microphone recognition and physical Echo/Alexa+ integration are **not verified**.
  The app presents Alexa+ as a web simulation.
- No public deployment or contest submission has been made. Home plans are
  saved in `data/homes/` when started with `npm start` or a launcher; phone journals are browser-local
  copies and should be exported for safekeeping.
