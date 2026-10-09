# Development log (internal implementation findings)

## 2026-10-04 — Local app integration

Observed in the supplied workspace:

- The existing phone HTML and travel/MCP modules were present, but the configured
  `src/server.js` entry point, home UI and current test suite were missing.
- Root README/test documentation referred to a separate classic Alexa skill source
  bundle that was not present. Those documents were retained as historical records;
  current instructions now describe files that actually exist.
- The phone's rescue implementation compared only title/stops when recovering.
  Private-note-only changes could be discarded as identical. Full journal comparison
  and newest-backup selection now protect those edits.
- An IndexedDB read failure could be hidden by storage fallback. A successful DB
  open now retains read errors so the app blocks writes over unreadable data.
- Missing/null weather data could be described as safe, and an unavailable forecast
  could permit an unjustified rain swap. Unknown weather is now represented explicitly.
- Long itinerary links can exceed QR capacity. The handoff preserves notes and uses
  a lower correction level when needed; physical scan quality still needs checking.
- Saving an older phone tab could overwrite a newer journal from another tab.
  IndexedDB now checks the last-read value and writes within the same transaction;
  conflicting edits stay available for rescue/export instead of replacing the newer copy.
- A model error after creating a proposal left the browser unaware of that proposal.
  Error handling now refreshes state without retrying the mutation.
- Express 5 passes a listen error to its callback. Ignoring that argument produced
  an unhelpful `null.port` error when a port was occupied. Startup now reports the
  actual error; occupied-port and restart behaviour are regression-tested. The
  default port is 4317 to avoid another local project's development server.

The default demonstration does not require AWS setup. Bedrock remains an explicit
opt-in path so a reviewer can exercise the complete core flow without paid model
calls. This is a record of observed implementation work, not product feedback
submitted to Amazon.

## 2026-10-04 — Hands-free conversation after Start

- The former mic button only filled a text field. Added a separate opt-in
  conversation mode with final-utterance submission, English/Japanese speech,
  exact spoken-proposal confirmation and phone handoff.
- Recognition must stop before speech starts, and late browser callbacks must not
  restart a stopped session. Generation guards, abort, read-aloud completion checks
  and bounded silence retries cover these timing cases.
- Browser constructors can throw even when the speech API exists. Those failures
  now stop cleanly and keep the text/form route available.
- Virtual/VPN adapters were present alongside the physical LAN. Address selection
  now prefers the private physical adapter for phone QR links.
- Voice quality and physical QR scanning still need device-level verification;
  automated browser checks use speech-event fixtures with real HTTP/MCP operations.

## 2026-10-09 — Kippu & stamp redesign

- The earlier look (sage green, cream, rounded white cards, a sparkle mark, one free
  handwriting font everywhere) read as generic. The new design ties the visuals to the
  product story: plan = ticket, trip = stamp rally, memories = stamp book, approval = an
  "OK" stamp. Echo Show itineraries became a departure board.
- One source for the art: `public/stamps.js` (ink-stamp SVGs, ticket-logo defs and an
  English → kanji table for station stamps) runs in the browser, in Node tests, and is
  inlined into the MCP Apps bundle and the standalone journal, so nothing drifts.
- Fonts are `text=` subsets from Google Fonts (130.8 KB in total). BIZ UDPGothic draws
  en dashes as hairlines, so U+2013/2014 are excluded from that face and fall back.
- The journal's CSS had grown in layers; the redesign adds one final skin layer and
  recolours the print section in place instead of rewriting 68 KB of CSS, which kept all
  storage, recovery and print-pagination behaviour intact.
- A decorative photo tilt made a QA check read the rotated bounding box as distortion;
  the check now measures layout boxes and still fails for real stretching.
