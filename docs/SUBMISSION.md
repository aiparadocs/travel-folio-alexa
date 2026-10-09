# Devpost submission text (draft)

Copy each section into the matching Devpost field. Items in `<angle brackets>` are filled
in just before submitting.

## Project name

Travel Folio

## Elevator pitch (max 200 characters)

Plan with Alexa at home, turn the trip into a scrapbook on your phone, then relive it
together on the Echo Show. Alexa remembers, watches the weather, and never changes a plan without your yes.

## Track and challenges

- Primary track: **Alexa+**
- Mini challenge: **Open Source** (new MIT-licensed project) `<and AWS Builder if Bedrock is verified>`

## About the project

### Inspiration

Planning a trip with a voice assistant is already possible. What gets lost is everything
after: the photos end up scattered in a camera roll, the little detours are forgotten, and
the trip that started around the kitchen screen never comes back to it.

We wanted an Alexa+ companion for the whole journey: plan together at home, keep a
scrapbook on the road, and bring the memories back to the kitchen screen so the family can
relive them. And it has to stay trustworthy: it suggests, the person decides.

### What it does

> **What is real and what is simulated.** This demo simulates how Travel Folio's MCP
> responses would appear on an Alexa device: the Alexa+ developer toolkit is not available
> to hackathon participants, so there is no real Alexa or Echo connection. The MCP server,
> its tool calls, the MCP Apps cards, the phone journal and the memory sharing are real and
> run locally.

**In one line:** voice-first travel planning with explicit consent — plan, disruption,
suggested replacement, visible diff, your confirmation, and finally a scrapbook you relive
together.

- **A scrapbook, not just an itinerary.** On the phone, every stop can hold a photo, a
  few words and up to three of 32 travel stickers. Unplanned detours become pages
  too ("An unplanned detour"). Each day turns into a light-kraft scrapbook page with
  station-style stamps, printable
  as an A4 booklet or saved as one offline HTML file.
- **A design you can hold.** Plan = a ticket, trip = a stamp rally, memories = a stamp book.
  Saying yes to a change stamps it "OK" on the Echo Show; visited stops get a 済 (done)
  stamp; every memory gets a station stamp with the place's Japanese name.
- **Relive it together on Echo Show.** Back home, choose "Show memories on Echo Show" on
  the phone. Alexa greets you ("3 memories from your phone just arrived. Shall I show
  them?") and plays them as a polaroid-style slideshow on the kitchen screen. Nothing
  leaves the phone until you choose to share it, and private notes never do.
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
  imports the itinerary and pairs with this home. Failed saves never lose an edit.

### How we built it

- **Self-hosted MCP server** (official MCP TypeScript SDK, spec 2025-11-25, Streamable
  HTTP): 12 tools (`preview_trip`, `create_trip`, `get_itinerary`, `get_next_stop`, `check_weather`,
  `list_places`, `propose_change`, `apply_change`, `undo_last_change`, `mark_visited`,
  `send_to_phone`, `show_memories`), resources for the current trip and each day, and a
  `morning_briefing` prompt. Tools carry annotations; `apply_change` asks the human through
  MCP elicitation when the client supports it.
- **MCP Apps** (`io.modelcontextprotocol/ui`, 2026-01-26): eight tools link a hashed
  `ui://` view. It is a single self-contained bundle with inlined fonts and an empty CSP
  allowlist. Our simulated Echo Show is a small MCP Apps host: it loads the view through a
  cross-origin sandbox proxy, as the spec requires of web hosts.
- **Alexa+ simulation:** a home web app that is the conversation surface (voice via the
  browser's speech APIs, or text), and an Echo Show 8 view that mirrors the same session.
  Every trip action is a real MCP call from an SDK client to the server.
- **Conversation:** a guided intent engine by default (no cloud account needed to judge
  the demo). An opt-in **Amazon Bedrock** mode uses the Converse API with tool use; the
  model's tool allowlist cannot apply, undo or confirm anything. Verified live with
  Amazon Nova 2 Lite through the Japan inference profile (requests stay in Tokyo/Osaka).
- **Weather:** Open-Meteo hourly precipitation, or a clearly labelled sample forecast for
  a reproducible demo. Unknown data is reported as unknown, never as "dry".
- **State:** each home plan is saved per browser and restored through MCP on return; the
  phone journal persists in IndexedDB with rescue copies.
- **Quality:** 98 automated tests (real HTTP/MCP journeys, the MCP Apps handshake run
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

- A full circle: a voice conversation becomes an Echo Show card, a phone scrapbook, a
  printed booklet, and finally a slideshow back on the kitchen screen, without an account.
- An assistant that speaks first when it matters, but cannot change anything on its own.
- The Echo Show cards follow the Alexa+ layout foundations (768x480 canvas, one root zoom)
  in Travel Folio's own kippu & stamp look.

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
