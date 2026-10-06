# Devpost submission text (draft)

Copy each section into the matching Devpost field. Items in `<angle brackets>` are filled
in just before submitting.

## Project name

Travel Folio

## Elevator pitch (max 200 characters)

Plan a trip with Alexa at home, carry the same plan on your phone, and keep it as a
scrapbook. Alexa remembers your trip, watches the weather, and never changes a plan without your yes.

## Track and challenges

- Primary track: **Alexa+**
- Mini challenge: **Open Source** (new MIT-licensed project) `<and AWS Builder if Bedrock is verified>`

## About the project

### Inspiration

Trips are planned in three places that never talk to each other. The idea starts at home,
often around a kitchen screen. The plan lives on a phone. The memories end up scattered
in a camera roll. And when the weather turns, every plan has to be rearranged by hand,
usually on the morning of the trip.

We wanted an Alexa+ companion that holds one plan through all three moments, speaks up
when something changes, and stays trustworthy: it suggests, the person decides.

### What it does

_Alexa+ itself is simulated (its developer toolkit is not available to hackathon
participants). The MCP server, the MCP Apps cards and the phone journal are real and run locally._

- **Plan by talking.** "Plan two easy days in Kyoto, with coffee." Travel Folio builds an
  itinerary from a curated list of real places and reads back a proposal. Nothing is
  created until you say yes to that exact proposal. English and Japanese.
- **Remembers you and speaks first.** Come back tomorrow (even after a restart) and it
  greets you with what matters: "Welcome back. Your 2-day Kyoto trip starts tomorrow.
  The forecast shows rain from 10:00 to 17:00, which affects Fushimi Inari. Shall I look
  for indoor alternatives? Nothing changes until you confirm."
- **Weather-aware changes with a before/after.** Rainy outdoor stops are swapped for
  nearby indoor places, later stops are re-timed, and the card shows exactly what moves.
  Visited and fixed stops are never touched. Undo is always one sentence away.
- **Echo Show cards with MCP Apps.** Itinerary, rain risk, proposals and results render as
  interactive MCP Apps views styled with the Alexa+ visual foundations (768x480 canvas,
  one root zoom per device), with "Try saying…" hints for the next step.
- **Take it to your phone.** "Take it to my phone" shows a QR code. The phone journal
  imports the itinerary; your photos, words and 32 travel stickers stay on the
  phone. Failed saves never lose an edit.
- **Keep it.** Export the whole journal as one offline HTML file, or print an A4 booklet
  (itinerary, memories or both) on kraft-paper styling, with no text dropped.

### How we built it

- **Self-hosted MCP server** (official MCP TypeScript SDK, spec 2025-11-25, Streamable
  HTTP): 11 tools (`preview_trip`, `create_trip`, `get_itinerary`, `get_next_stop`, `check_weather`,
  `list_places`, `propose_change`, `apply_change`, `undo_last_change`, `mark_visited`,
  `send_to_phone`), resources for the current trip and each day, and a
  `morning_briefing` prompt. Tools carry annotations; `apply_change` asks the human through
  MCP elicitation when the client supports it.
- **MCP Apps** (`io.modelcontextprotocol/ui`, 2026-01-26): seven tools link a hashed
  `ui://` view. It is a single self-contained bundle with inlined fonts and an empty CSP
  allowlist. Our simulated Echo Show is a small MCP Apps host: it loads the view through a
  cross-origin sandbox proxy, as the spec requires of web hosts.
- **Alexa+ simulation:** a home web app that is the conversation surface (voice via the
  browser's speech APIs, or text), and an Echo Show 8 view that mirrors the same session.
  Every trip action is a real MCP call from an SDK client to the server.
- **Conversation:** a guided intent engine by default (no cloud account needed to judge
  the demo). An opt-in **Amazon Bedrock** mode uses the Converse API with tool use; the
  model's tool allowlist cannot apply, undo or confirm anything.
- **Weather:** Open-Meteo hourly precipitation, or a clearly labelled sample forecast for
  a reproducible demo. Unknown data is reported as unknown, never as "dry".
- **State:** each home plan is saved per browser and restored through MCP on return; the
  phone journal persists in IndexedDB with rescue copies.
- **Quality:** 76 automated tests (real HTTP/MCP journeys, the MCP Apps handshake run
  against the real view script, voice-controller timing, restart/restore), plus browser
  QA for the journey, phone storage, printing and the Echo Show cards.

### Challenges we ran into

- **Making an agent safe to trust with a plan.** Proposals have IDs, expire after 15
  minutes and are rejected if the trip changed meanwhile; a spoken "yes" only counts for
  the proposal whose reading finished. "Yes, but…" is not a yes.
- **Rendering MCP Apps correctly without Alexa's tools.** The Alexa+ toolkit and Local
  Inspector are not available to participants, so we implemented the host side of the
  MCP Apps lifecycle ourselves and tested the real view script against it.
- **Honest weather.** A missing forecast hour is unknown, so automatic rain swaps are
  refused rather than guessed.

### Accomplishments that we're proud of

- One plan that moves from a voice conversation to an Echo Show card, a phone, and a
  printed page, without an account and without losing anything along the way.
- An assistant that speaks first when it matters, but cannot change anything on its own.
- The Echo Show cards follow Amazon's published design tokens.

### What we learned

MCP Apps make a voice-first assistant genuinely multimodal: the same tool result can be
spoken, shown as a card, and acted on. We also learned that the hard part of "agentic" is
not calling tools, it is deciding which calls need a human, and making that visible.

### What's next for Travel Folio

- Publish it as a real Alexa+ add-on when the MCP Toolkit opens up.
- Sync the phone journal back to the home plan, more cities, and opening-hour checks from
  an authoritative source.
- A "trip day" mode on Echo Show: next stop, travel time and a gentle heads-up before rain.

## Built with

Node.js, Express, Model Context Protocol (TypeScript SDK), MCP Apps, Amazon Bedrock
(Converse API, optional), AWS SDK for JavaScript v3, Open-Meteo, Web Speech API,
IndexedDB, Zod, QR code generator.

## Links

- Repository: `<GitHub URL>` (MIT)
- Demo video: `<YouTube URL>`

## Product feedback

**1. Which developer tools, APIs and SDKs did you use and for what?**
The MCP TypeScript SDK for our self-hosted Streamable HTTP server and for the simulator's
client; the MCP Apps specification for Echo Show cards; the Alexa+ MCP add-on design guide
(layout and rendering, visual foundations) for sizing and styling; the AWS SDK for
JavaScript v3 Bedrock Runtime client for the optional model conversation; Open-Meteo for
forecasts.

**2. What worked well?**
The Alexa+ visual foundations are concrete: a 768x480 canvas, a single root zoom per
device and a published type, spacing and colour scale made it fast to design a card that
fits an Echo Show. Stating the MCP spec version (2025-11-25) and transport up front removed
guesswork, and choosing MCP Apps for visuals means one view can serve several hosts. The
organizer answered forum questions quickly and clearly.

**3. What needs work?**
See our friction log. In short: the toolkit, CLI and Local Inspector cannot be used by
participants (the CLI and inspector return 404 on npm), there is no list of supported MCP
features such as elicitation and annotations, and the `hostContext` fields in the design
guide do not match the MCP Apps spec and have no example payload.

**4. How was your onboarding experience (zero to hello world)?**
The MCP server side reached a working tool call quickly with the SDK. "Hello world on
Alexa" was not reachable, because the QuickStart depends on a gated CLI. We replaced that
step with our own simulated host. A public sandbox would make the first hour much smoother.

**5. Would you build with these devices and services again?**
Yes. A voice assistant that can also show an interactive card on the kitchen screen is the
right home for a family travel plan, and MCP plus MCP Apps let us build it with open
standards. We would like to ship it on real Alexa+ devices once the toolkit is available.

## Friction log

Paste from [FRICTION_LOG.md](FRICTION_LOG.md).

## Open Source mini challenge fields

- Contribution URL: `<GitHub URL>`
- Repository URL: `<GitHub URL>`
- GitHub username: `<username>`
- Description: Travel Folio is a new MIT-licensed project: a self-hosted MCP server with
  MCP Apps views for Alexa+-style screens, an Echo Show simulator that implements the
  MCP Apps host and sandbox-proxy lifecycle, and an offline-first phone travel journal.
