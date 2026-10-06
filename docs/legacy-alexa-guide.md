# Archived GPT-Pro Alexa guide — reference only

This is the earlier guide supplied with the phone prototype. The `lambda/`,
`skill-package/`, and build files it describes are not included in this workspace.
It is preserved as historical context, not as setup instructions for the current
Travel Folio app. Use [the current README](../README.md).

This folder is **source code to deploy**, not an installed skill and not a live Alexa+ integration. No Amazon account has been accessed or changed.

## Intended experience

1. “Alexa, open Travel Folio.” → `LaunchRequest` → voice reply and an APL screen.
2. “Plan a trip.” → destination, days, pace and explicit confirmation.
3. Adjust day times, add a coffee stop or replace a walk with an indoor placeholder.
4. “Take it to my phone.” → the skill displays a locally generated AVG QR code for the hosted web app and adds the plan link to an Alexa app card.
5. On the phone, review/import that plan and add photos and memories locally. Phone edits do not flow back to the Echo.

This is a limited, deterministic planner. It does not search real venues, call a language model, reserve a table or claim a route is feasible. The APL code has been checked as JSON and tested through emitted directives, not rendered in Amazon's simulator or on an Echo.

## Files to use

- `skill-package/interactionModels/custom/en-US.json`: the English invocation and intent model.
- `skill-package/skill.json`: reference manifest. Use the endpoint ARN generated for **your** skill; no ARN, account or certificate is invented here. It is not a certification submission.
- `lambda/index.js`: entry point `index.handler`, direct Alexa JSON handling.
- `lambda/config.json`: your skill ID, published web URL and optional persistence settings.
- `lambda/core.js`, `assistant.js`, `transfer.js`, `qr.js`: copied by the root build from shared, tested modules.
- `lambda/package.json`: optional AWS SDK dependency for DynamoDB. No AWS dependency enters the web HTML.

## Console setup

Create a **Custom** skill in the Alexa Developer Console with default locale **English (US)**. Choose an available Node.js hosting option compatible with Node 20 or newer. Alexa-hosted is convenient when available; an AWS Lambda endpoint also works.

Paste the contents of `en-US.json` into the interaction-model JSON editor and build it. Enable the **Alexa Presentation Language (APL)** interface. The reference manifest selects rectangular displays; the voice fallback works without APL.

Copy the files in `lambda/` into the backend project. Do not copy only `index.js`: it imports the other files. Set these two values in `config.json`:

```json
{
  "skillId": "YOUR_ACTUAL_SKILL_ID",
  "publicAppUrl": "YOUR_ALREADY_PUBLISHED_HTTPS_INDEX_HTML_ADDRESS",
  "enablePersistence": true,
  "tableName": "",
  "tableRegion": "",
  "partitionKey": "id"
}
```

These are placeholders, not working credentials or a deployed address. Keep the existing config structure and fill in your actual values. Alternatively, set `EXPECTED_SKILL_ID` and `PUBLIC_APP_URL` environment variables. Requests for a different skill ID are rejected. For a self-managed Lambda, restrict its Alexa Skills Kit trigger to that same Skill ID. Do not expose this raw handler as an unsigned public HTTP endpoint.

Deploy the code and build the voice model. For an Alexa-hosted project, dependencies are installed as part of its deployment. For a separate Lambda deployment, install/package dependencies for the selected runtime and set the handler to `index.handler`.

Enable development testing in the console. Use the simulator first. Your Echo must be registered to the developer account (or included in an appropriate beta test), and its locale must match this skill: **English (United States)**. This package does not change the language of your device. Do not assume the Japanese phrase will invoke the English model.

Invoke: **“Alexa, open Travel Folio.”** It may need tuning or a new invocation name after real-device tests. “Travel Folio” is a temporary name and has not been name-cleared.

## Persistence and costs

When an Alexa-hosted DynamoDB table is available, the adapter reads `DYNAMODB_PERSISTENCE_TABLE_NAME` and `DYNAMODB_PERSISTENCE_REGION`. For another setup, set `tableName`, `tableRegion` and the actual partition key; the default key name is `id`. Verify the provisioned table schema and give the Lambda role only GetItem/PutItem access to that table.

If persistence is enabled but no table is configured, the skill uses **session-only** state. After creating a trip it explicitly tells the user to take the plan before leaving. It does not promise to remember it next time. A failed database operation is not announced as a successful save.

The DynamoDB record holds an itinerary and conversation state, keyed by a SHA-256 digest of Alexa's skill-scoped user identifier. Phone photos and memory captions are excluded. Do not enable persistence for production without implementing a user-facing deletion/retention policy and completing privacy disclosures. The current optional adapter is a development build.

The web demo requires no paid hosting. A real skill has deployed backend resources. Alexa-hosted/AWS may provide included usage, but free tiers and resource limits are not an unlimited-cost guarantee. Review the actual resources and billing settings in your account before deployment.

## What was verified

Synthetic `LaunchRequest`, `IntentRequest`, APL `UserEvent`, SessionEnded, English duration slots, confirmation/undo, APL directive assembly, offline QR encoding, skill-ID rejection, injected persistence isolation and save failure handling.

**Not verified:** uploading to Amazon, intent-model compilation, actual slot recognition, APL display rendering, DynamoDB calls, live account permissions, language setup, physical QR scanning, Alexa+ integration, certification or app-store approval. A device-render test is a prerequisite for claiming Echo compatibility.

## Official references, checked 2026-10-03

- Custom skill invocation: https://developer.amazon.com/en-US/docs/alexa/custom-skills/understanding-how-users-invoke-custom-skills.html
- Device testing/account/locale: https://www.developer.amazon.com/en-US/docs/alexa/test/test-your-skill-overview.html
- Console testing: https://www.developer.amazon.com/en-US/docs/alexa/devconsole/test-your-skill.html
- Alexa-hosted creation/dependencies: https://developer.amazon.com/en-US/docs/alexa/hosted-skills/alexa-hosted-skills-create.html
- Alexa-hosted persistence: https://developer.amazon.com/en-AU/docs/alexa/hosted-skills/alexa-hosted-skills-session-persistence.html
- APL interface: https://developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/apl-interface.html
- AVG graphics: https://www.developer.amazon.com/en-US/docs/alexa/alexa-presentation-language/apl-avg-format.html
- Alexa+ named invocation: https://www.developer.amazon.com/ja/docs/alexaplus/add-ons/mcp-addon-design-guide-overview.html
- Hackathon overview: https://amazonappdev2026.devpost.com/
- Hackathon access restrictions: https://amazonappdev2026.devpost.com/details/faqs
