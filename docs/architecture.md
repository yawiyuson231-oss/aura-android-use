# How AURA works

> **Keep this file current.** If you change the agent loop, the tool surface, the MCP link or the
> safety model, update this file in the same pull request.
>
> **Last reviewed:** 2026-11-10.

AURA is three programs that share one contract:

```
┌─────────────────────── the phone (no root, no cable) ───────────────────────┐
│                                                                             │
│  ┌──────────────┐   tools    ┌────────────────────┐   events   ┌──────────┐ │
│  │  :app        │───────────►│  :mcp-server       │◄───────────│ accessi- │ │
│  │  agent loop  │            │  the action space  │            │ bility   │ │
│  │  (Koog)      │◄───────────│  45 tools + guards │───────────►│ service  │ │
│  └──────┬───────┘  results   └─────────┬──────────┘  gestures  └──────────┘ │
│         │                              │                                    │
│         │ voice / text                 │ LAN signaling + WebRTC             │
│  ┌──────▼───────┐                      │                                    │
│  │ overlay,     │                      │                                    │
│  │ wake word    │                      │                                    │
│  └──────────────┘                      │                                    │
└────────────────────────────────────────┼────────────────────────────────────┘
                                         │  same Wi-Fi / hotspot / Tailscale
                            ┌────────────▼─────────────┐
                            │ aura-mcp-connect (Node)  │
                            │ one daemon per computer  │
                            └────────────┬─────────────┘
                                         │ http://127.0.0.1:4816/mcp
                        ┌────────────────┼────────────────┐
                   Claude Code        Cursor            VS Code / Zed / Cline
```

## The four moving parts

| Part | Where | What it is |
|---|---|---|
| **App** | `aura-android/app` | Compose UI, the on-device agent loop, voice, the overlay |
| **MCP server** | `aura-android/mcp-server` | Pure-Kotlin tool server the app hosts *in its own process*: the agent's action space |
| **Accessibility service** | `aura-android/app/.../accessibility` | Reads the screen tree, performs gestures, takes screenshots |
| **Bridge** | `aura-mcp-connect` (Node, MIT) | Lends the phone's MCP server to a desktop MCP client |

The important structural choice: **the agent is just another MCP client.** The on-device loop
connects to the in-process server over the same interface a laptop uses. One tool surface, one
safety layer, one log — no second code path that drifts.

## The agent loop

1. **Perceive.** `perceive_screen` waits for the screen to stop moving, then renders the node tree
   as a character grid of boxes, each with a `som_id` the model can target by number.
   `read_screen` is the cheaper text form. A screenshot (`get_screenshot`) is the escalation when
   looks matter — an unlabelled icon, a colour, an image.
2. **Decide.** The selected provider's model picks a tool and arguments.
3. **Guard.** Every call passes `scopedTool` (below) before it can touch the device.
4. **Act.** The accessibility service performs the tap/type/scroll, or the tool answers from the
   phone itself (deep links, contacts, notifications, media).
5. **Verify.** `verify_action` / `wait_for` / `post_action_observation` confirm the screen changed
   the expected way. `end_session` refuses to finish if the model acted and never looked.

The loop is bounded: a per-run request ceiling, an empty-turn policy, loop detection, and a
completion judge. A stalled provider surfaces as a failed run, not a hung app.

## Safety: three layers, one chokepoint

Everything the model can do goes through `scopedTool` in `:mcp-server`, so a rule added there
covers the on-device agent *and* every connected computer.

| Layer | File | Refuses |
|---|---|---|
| **Control lock** | `ControlLock.kt` | Everything, while a human has the phone. Human > agent > PC client. No tool is exempt. |
| **Action guard** | `ActionGuard.kt` | Acting on an unseen screen, repeating a gesture that did nothing, finishing without looking |
| **Policy** | `McpToolScopes`, `RestrictedAppsStore` | Banking/payment/authenticator apps, typing card numbers, PINs and passwords, dangerous settings |

Destructive actions ask the user first (`ConfirmDestructiveHook` → the overlay's question card).
Stopping is always possible and always wins: the pause pill, saying "stop", or grabbing the phone
mid-run. A paused run is checkpointed, not lost.

## How a computer reaches the phone

1. The phone opens a LAN-only signaling surface (`com.aura.mcp.lan`) and shows a one-time PIN.
2. `aura-mcp pair <pin>` finds the phone by mDNS, scans the subnet as a fallback, and connects.
3. Both screens show a 6-digit verification code; the user approves on the phone **only if they
   match**. The pairing is bound to the DTLS fingerprints of both ends.
4. A shared local daemon holds the single WebRTC link and serves MCP over Streamable HTTP on
   `127.0.0.1:4816`, so several clients share one phone connection.
5. Reconnects prove identity with a secret that is never sent again. No relay, no STUN/TURN, no
   cloud in the middle. Away from home, both devices join a private VPN such as Tailscale.

## What leaves the phone

| Leaves | Goes to | When |
|---|---|---|
| The task, screen tree text, screenshots | Your chosen AI provider, with your key | Every agent turn / a look |
| A generic "how do I…" question, help pages | Google, DuckDuckGo or Bing | Web research — off with one switch |
| Queries the AI wrote | Tavily | Only if you add a Tavily key |
| Counts, crash reports, install record | The project's Firebase | Diagnostics on (default); one switch turns it off |

Screen content never reaches a server belonging to this project. Voice-to-text and Live mode use
the user's own provider keys.

## Where to read next

- [`getting-started/build-and-run.md`](getting-started/build-and-run.md) — build it
- [`getting-started/first-task.md`](getting-started/first-task.md) — first run on a phone
- [`guides/connect-a-claude-code-or-cursor.md`](guides/connect-a-claude-code-or-cursor.md) — PC control
- [`guides/add-an-mcp-tool.md`](guides/add-an-mcp-tool.md) — extend the action space
- [`reference/tools.md`](reference/tools.md) — every tool and argument
- [`reference/permissions.md`](reference/permissions.md) — every permission and why
- [`explanation/safety.md`](explanation/safety.md) — the guard in depth
- [`decisions/livekit-wakeword.md`](decisions/livekit-wakeword.md) — the wake word engine (LiveKit
  primary, sherpa-onnx fallback)
- [`decisions/sherpa-onnx-over-porcupine.md`](decisions/sherpa-onnx-over-porcupine.md) — why the
  wake word never depends on a credential
- [`troubleshooting.md`](troubleshooting.md) — when it does not work
