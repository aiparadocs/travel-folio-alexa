# Friction log — Alexa+ track

Developer-experience friction met while building Travel Folio for the Build, Ship, Shape
Amazon Developer Hackathon (October 2026). Each entry follows the requested format.
Severity: **High** = blocked a goal, **Medium** = cost significant time or forced a design
workaround, **Low** = minor confusion.

Implementation notes about our own bugs are kept separately in
[DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).

---

## 1. No way to run our MCP server inside Alexa+

| | |
|---|---|
| **Task** | Connect our self-hosted MCP server (Streamable HTTP, spec 2025-11-25) to Alexa+ and see how Alexa+ chooses and calls our tools. |
| **Steps** | Read the Alexa+ track requirements and the Alexa+ MCP Toolkit overview and QuickStart. Tried `npm view @alexa-ai/cli`. Searched the hackathon forum. |
| **Expected** | A sandbox, simulator or test skill where a hackathon participant can point Alexa+ at an MCP URL. |
| **Actual** | The QuickStart installs `@alexa-ai/cli`, which is not on the public npm registry. The organizer confirmed in the forum that the toolkit and simulator are in preview with select partners and will not be available to participants. |
| **Severity** | High: no end-to-end validation against the real orchestrator, voice or device rendering. |
| **Workaround** | Built our own Alexa+ simulation: a home web app plus an "Echo Show view". Every trip action goes through the official MCP TypeScript SDK client over real Streamable HTTP to our server, so the server would not change for a real add-on. |
| **Suggestion** | Offer a hackathon-scoped sandbox, or a public "replay harness" that sends Alexa-style `tools/list`, `tools/call` and MCP Apps lifecycle traffic to a developer's URL and reports what Alexa+ would do. Until then, label pages that depend on gated tools as such at the top. |

## 2. The Local Inspector is documented but cannot be installed

| | |
|---|---|
| **Task** | Check our MCP Apps trip card against Alexa+ visual, accessibility and data-layer rules before recording the demo. |
| **Steps** | Followed the "Alexa+ Add-on Local Inspector" page. Ran `npm view @alexa-ai/addon-local-inspector` on 2026-10-06. |
| **Expected** | Install the package, run `addon-local-inspector <url>/mcp`, read `certification-verdict.json`. |
| **Actual** | `npm error 404 ... '@alexa-ai/addon-local-inspector@*' is not in this registry.` The page names rule IDs (e.g. "VR-01") but does not list the rules themselves. |
| **Severity** | Medium: we cannot claim compliance with Alexa's own quality bar. |
| **Workaround** | Wrote our own MCP Apps host and a cross-origin sandbox proxy that follow the MCP Apps 2026-01-26 spec, rendered the card in headless Chromium at Echo Show 8 size, and checked it manually against the published visual-foundation tokens. |
| **Suggestion** | Publish the inspector (even without device frames), or publish the rule list as a checklist so builders can self-assess. |

## 3. Unclear which MCP features Alexa+ honors

| | |
|---|---|
| **Task** | Design a safe confirmation step: an AI may propose a trip change, but only the person may apply it. |
| **Steps** | Implemented MCP elicitation (form mode) on `apply_change`, tool annotations (`readOnlyHint`, `destructiveHint`), `resources/list_changed` and `structuredContent`. Looked for which of these Alexa+ supports. |
| **Expected** | A capability matrix: elicitation, annotations, list_changed notifications, structured output, prompts, and how a destructive tool is confirmed by voice. |
| **Actual** | The MCP Toolkit overview states the spec version (2025-11-25), Streamable HTTP, tools/resources/prompts and MCP Apps, but we found no statement about elicitation, annotations or confirmation behaviour. |
| **Severity** | Medium: confirmation is the core safety feature of our add-on. |
| **Workaround** | Two paths. If the client declares elicitation, the server asks the human itself. Otherwise `apply_change` refuses unless called with `userConfirmed=true`, which our host only sends after a person presses Confirm or says "yes" to the exact proposal that was read aloud. Proposals expire and are rejected when the trip changed meanwhile. |
| **Suggestion** | Add a "Supported MCP features" table to the toolkit overview, and a design pattern for voice confirmation of state-changing tools. |

## 4. hostContext fields differ between the Alexa+ guide and the MCP Apps spec

| | |
|---|---|
| **Task** | Size the trip card correctly on Echo Show 8 and 15. |
| **Steps** | Read "Layout and rendering" and "Visual foundations" in the Alexa+ MCP add-on design guide, and the MCP Apps 2026-01-26 `HostContext` interface. |
| **Expected** | One documented `hostContext` schema with an example payload and the list of `deviceClass` values. |
| **Actual** | The Alexa+ guide says the host sends `deviceClass`, `maxWidth`, `maxHeight` and `isMobile`, and that `deviceClass` "wins outright", but gives no schema, example or values. The MCP Apps spec defines `containerDimensions` instead, and has no `deviceClass` or `isMobile`. |
| **Severity** | Low: the zoom guidance (768x480 canvas, `zoom: 1.667` on Echo Show 8/15) made a robust fallback possible. |
| **Workaround** | The card reads `containerDimensions.width`, then `containerDimensions.maxWidth`, then a top-level `maxWidth`, and applies one root zoom of width / 768. |
| **Suggestion** | Publish TypeScript types or a JSON example of Alexa's `hostContext`, including the `deviceClass` values, and say how they map to the MCP Apps fields. |

## 5. Requirements for the simulated route needed a forum thread

| | |
|---|---|
| **Task** | Decide what our submission must contain for the Alexa+ track. |
| **Steps** | Read the rules: an MCP server or Agent Skill, or a simulated Alexa+ experience "using any AI/agentic tool". |
| **Expected** | A short checklist of what is required on each route. |
| **Actual** | We first read the rules as requiring a live LLM and planned around a paid model dependency. The forum clarification (topic 45058) said a simulation needs no LLM, no voice and no particular UI. |
| **Severity** | Medium: about a day of planning based on a wrong reading. |
| **Workaround** | Default demo uses a guided conversation engine and needs no cloud account. Amazon Bedrock is an opt-in mode. The MCP server is real either way. |
| **Suggestion** | Move the forum clarifications into the rules page as a table: route, required technology, how it is judged. |

## 6. Amazon Bedrock onboarding

| | |
|---|---|
| **Task** | Make the first live request from Travel Folio's Bedrock mode (Converse API with tool use), 2026-10-09. |
| **Steps** | Bedrock console, Tokyo Region → API keys → short-term API key (ends with the console session, at most 12 hours). Set it as `AWS_BEARER_TOKEN_BEDROCK` for the server process only; the AWS SDK for JavaScript v3 (`client-bedrock-runtime` 3.1146) then uses bearer authentication by itself. Model: the Japan inference profile `jp.amazon.nova-2-lite-v1:0` from `ap-northeast-1`, so requests stay in Tokyo/Osaka. We did not create an IAM user or access key, or file a model access request. |
| **Expected** | The tool schemas our MCP server already publishes (JSON Schema generated by the MCP TypeScript SDK) work as `toolSpec.inputSchema.json`. |
| **Actual** | The first request failed. At that point the app showed only a generic error, so the exact exception text was not captured. The Amazon Nova tool-use troubleshooting page says the top level of a tool schema may contain only `type`, `properties` and `required`; ours also carried `$schema`. Sending only those three keys made the same request succeed. Separately, asked for "this Saturday", the model chose 2024-06-15: nothing had told it today's date. |
| **Severity** | High for a first run: tool use was blocked until the schemas were trimmed. The date issue would have created a trip in the past without warning. |
| **Workaround** | `src/agent/bedrock.js` sends only `type`, `properties` and `required`; the server now logs the AWS error name and message (never credentials); each city's date and weekday are part of the model's context. Then verified live: a create proposal with the right date (2026-10-10), a weather question answered through `check_weather`, a Japanese request that produced an indoor-swap proposal, and a request to "apply it yourself" that changed nothing until the person pressed Apply. |
| **Suggestion** | Accept or ignore `$schema` in Converse tool schemas for every model, or name the rejected key in the error message. A per-model table of the supported JSON Schema subset on the Converse tool-use page would help builders who reuse MCP tool schemas. |
