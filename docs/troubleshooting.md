# Troubleshooting

> **Last reviewed:** 2026-11-10.

Start with the run's trace: tap the finished run to see every tool call, its arguments, its result,
and the model's reasoning between calls. Most answers are already there.

## Setup

| Symptom | Cause | Fix |
|---|---|---|
| The accessibility toggle is greyed out | Android 13+ restricts grants for sideloaded apps | App info → ⋮ → **Allow restricted settings**, then enable |
| Accessibility turns itself off | An app on the restricted list opened; AURA steps out deliberately | It notifies you and comes back when you leave the app |
| "Restricted by Advanced Protection" | Android 17 Advanced Protection is on | Turn it off for the grant, then re-enable |
| Setup skips sign-in | A debug build with the placeholder Firebase file | Expected; only Firebase features are inactive |

## The agent

| Symptom | Cause | Fix |
|---|---|---|
| It taps the wrong thing | Stale `som_id` after the screen changed | Check the trace; a `perceive_first` or `stale_element` refusal is the guard working |
| It loops on one screen | The gesture does nothing | Press pause and look; `loop` refusals after three identical tries are by design |
| It stops mid-run and asks | `ask_user`: a choice only you can make | Answer the card, or say "continue" |
| "The user has taken their phone back" | The control lock saw human input | Hand control back: stop touching the phone, then say "continue" |
| Runs out of requests | The per-run request ceiling | Raise it in Settings → Agent Brain, or split the task |
| Very slow, one turn forever | Provider stalls | Timeouts are enforced; the run fails rather than hangs. Try another provider or model |
| `permission_denied` on files | Media permission not granted | Grant Photos & media, or use the app's own picker |

## Provider and keys

| Symptom | Cause | Fix |
|---|---|---|
| `401` / `invalid api key` | Wrong or revoked key | Paste it again; keys are per endpoint |
| `429`, quota exhausted | Free-tier limit | Wait, or switch provider; the app reports quota exhaustion separately from other errors |
| `Fetch models` returns nothing | Endpoint needs a different base URL or listing path | Custom endpoints can set both; leave the path blank for the default |
| Reasoning level is ignored | The model cannot honour it | The app strips it at the wire rather than sending a field the model rejects |
| Model answers but never calls tools | Not a tool-calling model | Pick one that supports tools; screen-grid work needs it |

## Web research

| Symptom | Cause | Fix |
|---|---|---|
| No research notes before a run | Switch is off, or the search engine challenged the request | Check **Settings → Web research**; a blocked search soft-fails and the run continues |
| `look_up` is missing | Same switch | It is not registered while the switch is off |
| Research notes are about the wrong app | App matching guessed | Name the app in the request |

## MCP from a computer

| Symptom | Cause | Fix |
|---|---|---|
| `connection refused` | The daemon is not running (the URL form of a client config never starts it) | Use the `aura-mcp` command form, or run `aura-mcp daemon` |
| Phones not found during `pair` | Router isolates clients | `aura-mcp pair <pin> --host=<address from the MCP tab>` |
| The MCP tab says the server is stopped | MCP is off | Tap **Start server** |
| Client sees no tools | Pairing was revoked, or the phone's server stopped | Re-pair, or check Trusted Devices |
| Works on Wi-Fi, not on mobile data | By design: LAN only | Use Tailscale on both devices (see the guide) |
| Everything is refused | A human has taken the phone | The lock is on; hand it back |

## Build

See [Build and run → Common build failures](getting-started/build-and-run.md#common-build-failures).

## Reporting a bug

The run trace is the most useful artefact and it contains screen text, so read it before you share
it. Include: phone model, Android version, AURA version (Settings → Build), provider and model, what
you asked, and the step where it went wrong.
