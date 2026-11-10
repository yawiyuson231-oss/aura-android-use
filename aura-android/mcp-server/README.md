# `:mcp-server` — the phone's action space

> **Keep this file current.** If you add, remove, rename or repurpose anything here, update this
> README in the same commit.
>
> **Last reviewed:** 2026-11-10.

A pure-Kotlin MCP server that the app hosts **in its own process**. It is the agent's entire action
space, and the same server a computer connects to over the LAN link — so the on-device agent and a
desktop client run through one set of tools and one safety layer.

No `android.*` imports in the tool logic, which is why the whole action space is testable on the JVM
against a mock phone (`src/test/.../bench/`) with no emulator.

## Where things live

| Folder | What it holds |
|---|---|
| `server/` | The chokepoint and the guards: `InProcessMcpServer`, `McpServerBuilder`, `McpToolCatalog`, `McpToolScopes`, `ActionGuard`, `ControlLock`, `ForegroundGuard`, `Doctrine`, safety resources and prompts |
| `tools/` | The tools themselves, by group: `Gesture`, `Perception`, `App`, `DeepLink`, `SystemIntent`, `Notification`, `Media`, `Contact`, `File`, `Browser`, `Step`, `EndSession` |
| `bridge/` | Ports to the app: `PerceptionBridge`, `UiTreeBridge`, `ScreenshotBridge`, `DeviceBridge`, `AppBrowserBridge` (in `:app`), plus pairing, LAN and the audit log |
| `cache/` | `PerceptionCache`, `ScreenGeneration`, `ScreenActivity`: what the last look saw, so `som_id`s can be validated against a generation |
| `lan/` | LAN-only signaling, `PinGate`, `ConnectAuthorizer`, `LanPolicy` |
| `auth/`, `log/` | Principal scoping and the session log |

## Rules a contributor must not break

1. **Every tool goes through `scopedTool`.** A tool registered outside it is unreachable by the
   guards, which means unreachable by the safety story. `McpToolScopes` lists which set a tool
   belongs to, and `ActionGuardListsTest` fails when a gesture tool is missing from the
   grounding-required set.
2. **Guards sit below the model.** If a rule matters, enforce it here, not in a prompt. Real traces
   show prompts get ignored exactly when the rule matters most.
3. **A refusal is a tool result, not an exception.** The message is written for a model: say what
   was refused and what to do instead, and never suggest retrying a call that cannot succeed.
4. **Tool descriptions are a budget.** `ToolDescriptionBudgetTest` guards the per-tool size; a
   description that grows without bound costs every client tokens on every request.
5. **The bench is the regression suite.** `bench/ToolBenchTest` runs adversarial scenarios against
   `MockPhone` and writes `build/toolbench/report.html`. It fails on status `fail` only; a `gap`
   names the planned change that closes it.

## Tests

```bash
cd aura-android
./gradlew :mcp-server:test
```

## Adding a tool

[`docs/guides/add-an-mcp-tool.md`](../../docs/guides/add-an-mcp-tool.md).
