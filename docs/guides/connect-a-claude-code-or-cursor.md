# Connect Claude Code or Cursor to your phone

> **Last reviewed:** 2026-11-10.
>
> Checked against the current Claude Code docs (`claude mcp add`, `add-json`, scopes) and the
> client config formats below.

This exposes your phone as an **MCP server**. A desktop agent then sees 45 tools — perceive, tap,
type, scroll, open apps, read notifications — and can drive the phone the same way the on-device
assistant does, under the same safety rules.

The phone is never reachable from the internet. The link is direct, over your local network, and
end-to-end encrypted.

## What you need

- The phone and the computer on **the same network**: same Wi-Fi, or the computer on the phone's
  hotspot.
- **Node.js 18+** on the computer.
- AURA **1.0.534 or newer** on the phone.

## 1. Start the server on the phone

AURA → **MCP** tab → **Start server**. The tab shows a 6-digit PIN and the phone's address. The PIN
works once and changes after each pairing.

## 2. Pair the computer

```bash
npm install -g aura-mcp-connect@latest
aura-mcp pair 123456
```

`pair` finds the phone on the network, connects, and prints a **verification code**. Your phone
shows an approval dialog with a code of its own.

> **Approve on the phone only if the two codes match.** They are what proves the phone is talking
> to your computer and not something sitting in the middle of the network.

If `pair` cannot find the phone (some routers hide devices from each other), use the address shown
on the MCP tab:

```bash
aura-mcp pair 123456 --host=192.168.1.23
```

On Windows, allow Node.js on **Private** networks when the firewall asks.

Pairing is saved to `~/.aura/webrtc.json`. Keep that file private; it identifies this computer to
your phone. Revoke a computer any time in AURA → **MCP → Trusted Devices**.

## 3. Add AURA to your client

One daemon per computer owns the single phone link; every client shares it.

### Claude Code

```bash
claude mcp add aura -- aura-mcp              # macOS / Linux
claude mcp add aura -- cmd /c aura-mcp       # Windows
```

Verify with `claude mcp list`, then use `/mcp` inside a session to see the server and its tools.

To make it available in every project, add `--scope user`.

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{ "mcpServers": { "aura": { "command": "aura-mcp", "args": [] } } }
```

### Claude Desktop, VS Code, Cline, Windsurf, Zed

```json
{ "mcpServers": { "aura": { "command": "aura-mcp", "args": [] } } }
```

**Windows:** most clients cannot launch an npm `.cmd` shim directly:

```json
{ "mcpServers": { "aura": { "command": "cmd", "args": ["/c", "aura-mcp"] } } }
```

> **Clients that only take a URL:** a URL cannot start the daemon, so run `aura-mcp daemon` first
> (again after every reboot), then point the client at `http://127.0.0.1:4816/mcp`. Any client that
> speaks the current MCP spec reads that **Streamable HTTP** endpoint.

## 4. Try it

In Claude Code:

> Look at my phone's screen and tell me what app is open.

> Open Google Maps and start directions home.

The first thing a good agent does is call `perceive_screen` or `get_device_status`. If it starts
tapping blind, it will be refused with `perceive_first` — that is the guard working, not a bug.

## What the PC client cannot do

The rules are identical to the on-device agent's, because both go through the same chokepoint:

- **It cannot act while you hold the phone.** Picking the phone up pauses the run; the client gets
  a refusal that says so and must stop, not retry.
- **Restricted apps are off-limits** — banking, payment, authenticator apps, plus anything you add
  in **Settings → Restricted Apps**.
- **Card numbers, PINs and passwords will not be typed.**
- **Destructive actions ask you on the phone first.**
- **You can revoke the computer** at any time in Trusted Devices, which ends the session.

Every tool call is logged on the phone in **MCP → Activity Log**.

## Away from home

The link only works between devices that can reach each other directly. Put both on a private VPN
— [Tailscale](https://tailscale.com) is free for personal use:

1. Install Tailscale on the phone and the computer, same account.
2. The MCP tab lists the phone's Tailscale address (`100.x.y.z`).
3. `aura-mcp pair 123456 --host=100.101.102.103`

## Troubleshooting

| Symptom | Fix |
|---|---|
| `connection refused` from the client | The daemon is not running: use the `aura-mcp` command form, or start `aura-mcp daemon` |
| Client connects, no tools | The phone's server is stopped, or the pairing was revoked |
| Pairing says the phone does not know this computer | Revoke it in Trusted Devices and pair again |
| Works at home, not on cellular | Expected: this is a local-network link. Use Tailscale |
| Tools time out on the first call | Native WebRTC (~50 MB) downloaded late; run `npm install -g aura-mcp-connect@latest` once |

The full bridge reference is [`aura-mcp-connect/README.md`](../../aura-mcp-connect/README.md).
