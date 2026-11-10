# Add an LLM provider

> **Last reviewed:** 2026-11-10.

Providers are **data, not code**. Every endpoint is reached through the one OpenAI-wire client
(`OpenAiCompatProvider`), and a `ProviderProfile` describes how that provider differs. Adding a
popular provider is usually one entry in `LlmEndpointCatalog`; only a genuinely different wire
format needs a profile.

Before writing code, check whether the provider is already reachable as a **custom endpoint** in
Settings → Agent Brain. Any OpenAI-compatible base URL plus a key works today with no change here —
that covers most new providers, and users can add one themselves.

## The normal case: one catalog entry

`app/src/main/java/com/aura/aura_ui/agent/llm/LlmEndpointCatalog.kt`:

```kotlin
private fun endpoint(
    id: String,
    displayName: String,
    baseUrl: String,
    profile: ProviderProfile = ProviderProfile.OPENAI_COMPATIBLE,
    modelsUrl: String = "$baseUrl/v1/models",
) = LlmEndpoint(…)
```

Add:

```kotlin
endpoint(
    id = "example",
    displayName = "Example AI",
    baseUrl = "https://api.example.com",
),
```

Then check three things, in this order:

### 1. Does the model list come back?

**Fetch models** in Settings calls `modelsUrl`. If the provider does not implement
`GET /v1/models`, set `modelsUrl` to the correct path or leave the field for users to type a model
id. A provider that lists nothing is still usable — but say so in the class KDoc.

### 2. Does it need a profile?

`ProviderProfile` exists for differences that would otherwise break a run:

| Difference | Examples already handled |
|---|---|
| Reasoning fields on the wire | `reasoning_effort`, Gemini's thinking config, OpenRouter's reasoning-details echo |
| Tool-call argument repair | Providers that emit malformed JSON arguments |
| Finish-reason quirks | Gemini's finish reason needing repair |
| Parallel tool calls | A provider that rejects them needs the splice interceptor |

If nothing in that table applies, the default profile is correct. If one does, add a
`ProviderProfile` and an interceptor in `agent/llm/` — and a wire test, because these are the bugs
that only show up on a real request.

### 3. Does it need a key at all?

`requiresKey` on the endpoint. A local endpoint (Ollama, LM Studio, a LAN server) does not.
`LlmUrlValidator` allows a private host only for such endpoints.

## Tests

```bash
cd aura-android
./gradlew :app:testDebugUnitTest
```

Add a unit test for anything pure (URL assembly, a profile mapping), and if the provider is live,
extend `src/androidTest/.../ModelCatalogLiveTest` so a real key can prove the endpoint answers.

## Docs to update in the same PR

- `LlmEndpointCatalog` KDoc, if the provider has a caveat a reader must know.
- The provider list in [`docs/getting-started/first-task.md`](../getting-started/first-task.md), if
  it changes what a user sees by default.
- The privacy table in [`docs/explanation/privacy.md`](../explanation/privacy.md), because a new
  provider is a new place data goes.

## What not to do

- **Do not add a second HTTP client.** One wire client with profiles is what keeps retries, timeouts
  and tool-call repair consistent across every provider. A bespoke client silently loses all of it.
- **Do not special-case a model id in the agent loop.** Capability questions belong in
  `ModelCatalog` (`reasoningCapableForWire`, vision tri-state), not in `if (model == …)` in a run.
- **Do not send a field the model cannot honour.** `ProviderRegistry.gateReasoning` strips it at the
  wire for exactly this reason; follow that pattern rather than trusting configuration.
