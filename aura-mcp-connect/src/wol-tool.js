/**
 * wake-on-lan — a local MCP tool that sends a Wake-on-LAN magic packet to a machine on THIS
 * computer's network, so a client can turn a PC on from the phone or from a laptop.
 *
 * - Why local, not on the phone: WOL is a link-layer UDP broadcast. The phone is doing its own
 *   thing on its own Wi-Fi and has no idea of this computer's subnet or interface; the machine
 *   that must send the packet is the one that shares a wire with the target. Registered as a
 *   `localTools` entry in the daemon's proxy server (see `proxy-core.js`), exactly like
 *   `aura-adb`, so it never touches the WebRTC link and the phone's safety checks are not
 *   pretended to apply to a network this code cannot see.
 * - Off unless armed: it sends broadcast packets onto the user's LAN, which is not something a
 *   client should get merely by connecting. Armed with `--enable-wol` / `AURA_MCP_ENABLE_WOL=1`,
 *   mirroring `aura-adb`.
 * - Reads: `~/.aura/wol.json` (optional target list). Writes: nothing.
 * - Fails: a handler always resolves to an MCP result. A bad MAC, a broadcast error or an
 *   unreachable host comes back as `isError: true` with a sentence a model can act on, never as a
 *   rejected promise (the SDK would drop the session).
 */
import fs from "fs";
import os from "os";
import path from "path";
import dgram from "dgram";

/** Wake-on-LAN's conventional port. 7 is echo and 9 is discard; both are accepted by NICs. */
export const DEFAULT_PORT = 9;
/** Discard. Sent to a second port because some NICs only listen on one of the two. */
export const SECONDARY_PORT = 7;
/** A magic packet is 6× 0xFF followed by the target MAC repeated 16 times. */
export const MAC_REPEATS = 16;

/**
 * Where the optional target list lives.
 *
 * Shape: `{ "targets": [ { "name": "desk", "mac": "AA:BB:CC:DD:EE:FF", "broadcast": "192.168.1.255" } ] }`
 * - Contract: absent file is normal and means "pass a MAC per call". A malformed file is ignored
 *   rather than fatal, so a bad edit cannot stop the daemon from starting.
 */
export function targetsFilePath() {
  return path.join(os.homedir(), ".aura", "wol.json");
}

/**
 * Normalise a MAC address to twelve lowercase hex characters, or null when it is not a MAC.
 *
 * - Contract: accepts `AA:BB:CC:DD:EE:FF`, `aa-bb-cc-dd-ee-ff`, `aabb.ccdd.eeff` and
 *   `AABBCCDDEEFF`. Requires a real unicast address: `FF:FF:FF:FF:FF:FF` is the broadcast
 *   address and would send a packet to every NIC, so it is refused.
 * - Pure, so the validation rules are unit-tested without a socket.
 */
export function normalizeMac(input) {
  if (typeof input !== "string") return null;
  const hex = input.replace(/[\s:.-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  // A locally administered or multicast address is not a NIC; all-FF is broadcast.
  if (hex === "ffffffffffff") return null;
  if ((parseInt(hex.slice(0, 2), 16) & 0x01) === 0x01) return null;
  return hex;
}

/** `aabbccddeeff` → `AA:BB:CC:DD:EE:FF`, for messages the model and the user both read. */
export function formatMac(hex) {
  return (hex.match(/.{2}/g) ?? []).join(":").toUpperCase();
}

/**
 * Build the 102-byte magic packet for [hexMac].
 *
 * - Contract: [hexMac] must already be normalised by {@link normalizeMac}; this does not
 *   re-validate, so callers keep one validation path.
 */
export function buildMagicPacket(hexMac) {
  const mac = Buffer.from(hexMac, "hex");
  const packet = Buffer.alloc(6 + MAC_REPEATS * 6, 0xff);
  for (let i = 0; i < MAC_REPEATS; i++) mac.copy(packet, 6 + i * 6);
  return packet;
}

/**
 * Read the optional target list. Never throws: an unreadable or malformed file yields [].
 *
 * @returns {Array<{name: string, mac: string, broadcast?: string}>} `mac` normalised.
 */
export function loadTargets(file = targetsFilePath()) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(raw?.targets) ? raw.targets : [];
  const out = [];
  for (const t of list) {
    const mac = normalizeMac(t?.mac);
    if (!mac || typeof t?.name !== "string" || !t.name) continue;
    out.push({ name: t.name, mac, broadcast: t.broadcast });
  }
  return out;
}

/** Resolve what the model asked for to a target, or an error message string. */
export function resolveTarget(args, targets) {
  const want = typeof args?.target === "string" ? args.target.trim() : "";
  const byMac = normalizeMac(args?.mac);
  if (byMac) return { mac: byMac, broadcast: args?.broadcast };

  if (want) {
    const named = targets.find((t) => t.name.toLowerCase() === want.toLowerCase());
    if (!named) {
      const known = targets.map((t) => t.name).join(", ") || "none configured";
      return { error: `No saved target named '${want}'. Saved: ${known}. Pass 'mac' instead.` };
    }
    return { mac: named.mac, broadcast: args?.broadcast ?? named.broadcast };
  }
  if (typeof args?.mac === "string" && args.mac.trim()) {
    return { error: `'${args.mac}' is not a valid MAC address. Use 12 hex digits, e.g. AA:BB:CC:DD:EE:FF — the target machine's NIC, not the broadcast address.` };
  }
  return {
    error:
      "wake_on_lan needs a target: pass 'mac' (e.g. AA:BB:CC:DD:EE:FF) or 'target' (a name from ~/.aura/wol.json).",
  };
}

/**
 * Send [packet] to [address]:[port] and resolve, never reject.
 *
 * A UDP broadcast is unacknowledged **and unreliable**: the OS accepts the datagram and drops it
 * silently when there is no route or no listener, and `dgram`'s send callback does not report that
 * as an error. So `ok: true` means only "this machine accepted the packet for sending" — never
 * "the target received it", and never "the target woke". Real failures that *are* reported (a bad
 * address, a permission denial, no broadcast capability) resolve as `{ ok: false, error }`.
 *
 * @param {{socketFactory?: () => import("node:dgram").Socket}} [deps] injectable for tests.
 */
export function sendPacket({ address, port, packet, socketFactory = () => dgram.createSocket("udp4") }) {
  // A socket error can arrive with an empty or missing message (observed on an
  // unroutable send), and "undefined" in a tool result tells the user nothing.
  const describe = (e) => e?.message || e?.code || String(e || "") || "unknown socket error";
  return new Promise((resolve) => {
    let socket;
    try {
      socket = socketFactory();
    } catch (e) {
      resolve({ ok: false, error: `could not open a UDP socket: ${describe(e)}` });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* already closed by the error path */
      }
      resolve(result);
    };

    // 'error' must be handled before anything else: an unhandled UDP 'error' event throws and
    // would take the daemon down rather than failing one tool call.
    socket.on("error", (e) => finish({ ok: false, error: describe(e) }));
    socket.bind(() => {
      try {
        socket.setBroadcast(true);
      } catch (e) {
        finish({ ok: false, error: `could not enable broadcast: ${describe(e)}` });
        return;
      }
      socket.send(packet, 0, packet.length, port, address, (e) =>
        finish(e ? { ok: false, error: describe(e) } : { ok: true }),
      );
    });
  });
}

/**
 * Which broadcast addresses to try, most specific first.
 *
 * A directed broadcast for the interface's own subnet (192.168.1.255) gets through routers and
 * VLANs more reliably than 255.255.255.255, so it is preferred; the limited broadcast is the
 * fallback for the container/pinned-route cases where the directed one has no route.
 *
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces] injectable for tests.
 */
export function broadcastAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const addresses of Object.values(interfaces ?? {})) {
    for (const a of addresses ?? []) {
      if (a.family !== "IPv4" || a.internal || !a.netmask) continue;
      const ip = a.address.split(".").map(Number);
      const mask = a.netmask.split(".").map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      const broadcast = ip.map((octet, i) => (octet & mask[i]) | (~mask[i] & 0xff)).join(".");
      if (!out.includes(broadcast)) out.push(broadcast);
    }
  }
  // Limited broadcast last: it works when a directed broadcast has no route.
  out.push("255.255.255.255");
  return out;
}

/**
 * What the handshake says about wake-on-lan. Short on purpose: Claude Code keeps only ~2 KB of a
 * server's `instructions` and the phone's own text already uses most of it (see `adb-tool.js`).
 */
const INSTRUCTIONS =
  "You also have `wake_on_lan`: send a Wake-on-LAN magic packet to a machine on this computer's " +
  "network. It only works on the local network, cannot confirm the machine actually woke, and " +
  "never reaches the phone. Ask before waking a machine that other people may be using.";

const DESCRIPTION = `
Turn a machine on with a Wake-on-LAN magic packet. Runs on THIS computer (where the daemon runs), not the phone: the packet is a UDP broadcast onto this computer's LAN, so the target must be on the same network segment.

Pass \`mac\` (e.g. AA:BB:CC:DD:EE:FF) or \`target\` (a name from ~/.aura/wol.json, e.g. "desk"). \`broadcast\` overrides the destination address when the interface guess is wrong.

WHAT SUCCESS MEANS: the packet was handed to the OS for broadcast. Wake-on-LAN has no acknowledgement — the result cannot tell you the machine woke. Verify separately (ping it, or connect to it) before telling the user it is up.

FAILS WHEN: the target is on another subnet (broadcast does not route across routers), the NIC has WoL disabled in its firmware or OS power settings, the machine is on Wi-Fi (WoWLAN is rarely enabled), or the machine was fully powered off in a way that drops the NIC's standby power. Report the error text; retrying the same call will not help.

SAFETY: this turns hardware on in someone's home or office. Do not wake machines in a loop, and confirm with the user before waking one that other people may be using.
`.trim();

/**
 * Build the tool.
 *
 * The seams (`send`, `targets`, `interfaces`) exist so tests drive the handler without a socket or
 * a real network — the same injection style as `createAdbTool({ run })`.
 *
 * @param {{
 *   send?: typeof sendPacket,
 *   targets?: ReturnType<typeof loadTargets>,
 *   interfaces?: () => ReturnType<typeof os.networkInterfaces>,
 * }} [deps]
 */
export function createWolTool({ send = sendPacket, targets = loadTargets(), interfaces } = {}) {
  return {
    /** Merged into the handshake instructions by buildProxyServer. */
    instructions: INSTRUCTIONS,

    definition: {
      name: "wake_on_lan",
      description: DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          mac: {
            type: "string",
            description: "Target NIC's MAC address, e.g. AA:BB:CC:DD:EE:FF. Ignored when 'target' matches a saved name.",
          },
          target: {
            type: "string",
            description: "Name of a saved target from ~/.aura/wol.json, e.g. 'desk'.",
          },
          broadcast: {
            type: "string",
            description: "Broadcast address to send to. Defaults to this machine's subnet broadcast.",
          },
        },
        required: [],
      },
      annotations: {
        // Not read-only: it turns a machine on. Not destructive either — no data changes.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },

    /** @param {{mac?: string, target?: string, broadcast?: string}} args */
    async handler(args) {
      const resolved = resolveTarget(args, targets);
      if (resolved.error) {
        return { content: [{ type: "text", text: resolved.error }], isError: true };
      }

      const packet = buildMagicPacket(resolved.mac);
      const addresses = resolved.broadcast
        ? [resolved.broadcast]
        : broadcastAddresses(interfaces ? interfaces() : undefined);

      // Try each address and port until one is accepted. The first success is enough: sending
      // duplicates is harmless, but a failure on the directed broadcast must not stop us trying
      // the limited one.
      const attempts = [];
      for (const address of addresses) {
        for (const port of [DEFAULT_PORT, SECONDARY_PORT]) {
          const result = await send({ address, port, packet });
          attempts.push({ address, port, ...result });
          if (result.ok) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `Sent a Wake-on-LAN packet for ${formatMac(resolved.mac)} to ${address}:${port}. ` +
                    `This means this machine accepted the packet for sending, nothing more: UDP ` +
                    `broadcast is unacknowledged and is dropped silently if the target is on ` +
                    `another subnet. Confirm the machine actually woke before telling the user it ` +
                    `is up — and expect it to take 10-60 seconds to answer.`,
                },
              ],
            };
          }
        }
      }

      const detail = attempts.map((a) => `${a.address}:${a.port} — ${a.error}`).join("; ");
      return {
        content: [
          {
            type: "text",
            text:
              `Could not send the magic packet: ${detail}. ` +
              `The target is probably on another subnet (broadcast does not cross routers — run the ` +
              `daemon on a machine on the same network), or this computer has no active IPv4 ` +
              `interface. WoL also needs to be enabled in the target's NIC firmware and OS power settings.`,
          },
        ],
        isError: true,
      };
    },
  };
}

export const wolTool = createWolTool();
