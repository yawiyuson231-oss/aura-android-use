/**
 * wake-on-lan unit test — no real socket, no real network, no real machine to wake.
 *
 * `createWolTool({ send, targets, interfaces })` takes all three as dependencies precisely so this
 * file can assert on the exact bytes that *would* have been broadcast, and on how the handler
 * turns a failure into an MCP result instead of an unhandled rejection.
 *
 * Run: node test/wol-tool.test.mjs
 */
import assert from "node:assert/strict";
import {
  buildMagicPacket,
  broadcastAddresses,
  createWolTool,
  formatMac,
  loadTargets,
  normalizeMac,
  resolveTarget,
} from "../src/wol-tool.js";
/** Label a completed group; the file prints one summary line at the end, like the others. */
function passes(label) {
  console.log(`  ok  ${label}`);
}

// ── MAC validation ────────────────────────────────────────────────────
{
  const valid = {
    "AA:BB:CC:DD:EE:FF": "aabbccddeeff",
    "aa-bb-cc-dd-ee-ff": "aabbccddeeff",
    "aabb.ccdd.eeff": "aabbccddeeff",
    AABBCCDDEEFF: "aabbccddeeff",
    "  00:1A:2B:3C:4D:5E  ": "001a2b3c4d5e",
  };
  for (const [input, expected] of Object.entries(valid)) {
    assert.equal(normalizeMac(input), expected, `should accept ${input}`);
  }

  // Everything that must NOT reach a socket.
  const invalid = [
    "", "not-a-mac", "AA:BB:CC:DD:EE", "AA:BB:CC:DD:EE:FF:00",       // wrong length
    "GG:BB:CC:DD:EE:FF",                                            // not hex
    "FF:FF:FF:FF:FF:FF",                                            // broadcast: every NIC
    "01:00:5E:00:00:01",                                            // multicast bit set
    null, undefined, 42, {},                                        // not a string
  ];
  for (const input of invalid) {
    assert.equal(normalizeMac(input), null, `should refuse ${JSON.stringify(input)}`);
  }
  passes("MAC validation: formats accepted, broadcast/multicast/garbage refused");
}

// ── The magic packet is exactly the documented 102 bytes ──────────────
{
  const packet = buildMagicPacket("aabbccddeeff");
  assert.equal(packet.length, 102, "6 × 0xFF + 16 × 6-byte MAC");
  assert.deepEqual([...packet.subarray(0, 6)], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  // The MAC must appear 16 times, back to back, with nothing between.
  const mac = Buffer.from("aabbccddeeff", "hex");
  for (let i = 0; i < 16; i++) {
    const start = 6 + i * 6;
    assert.deepEqual([...packet.subarray(start, start + 6)], [...mac], `repeat ${i}`);
  }
  assert.equal(formatMac("aabbccddeeff"), "AA:BB:CC:DD:EE:FF");
  passes("magic packet: 6×FF then the MAC 16 times, 102 bytes total");
}

// ── Target resolution: mac, saved name, and the error paths ───────────
{
  const targets = [
    { name: "desk", mac: "aabbccddeeff", broadcast: "192.168.1.255" },
    { name: "NAS", mac: "001122334455" },
  ];
  assert.deepEqual(resolveTarget({ mac: "AA:BB:CC:DD:EE:FF" }, targets), {
    mac: "aabbccddeeff",
    broadcast: undefined,
  });
  // A saved name brings its own broadcast along.
  assert.deepEqual(resolveTarget({ target: "desk" }, targets), {
    mac: "aabbccddeeff",
    broadcast: "192.168.1.255",
  });
  // Case-insensitive on the name the model was told about.
  assert.equal(resolveTarget({ target: "nas" }, targets).mac, "001122334455");
  // An explicit broadcast always wins over the saved one.
  assert.equal(resolveTarget({ target: "desk", broadcast: "10.0.0.255" }, targets).broadcast, "10.0.0.255");

  assert.match(resolveTarget({ target: "nope" }, targets).error, /No saved target named 'nope'/);
  assert.match(resolveTarget({ mac: "zz:zz" }, targets).error, /not a valid MAC address/);
  assert.match(resolveTarget({}, targets).error, /needs a target/);
  // A near-miss name must not silently fall back to broadcasting to nobody.
  assert.match(resolveTarget({ target: "desk ", mac: "not-a-mac" }, []).error, /No saved target/);
  passes("target resolution: mac, saved name, override, and every error path");
}

// ── loadTargets never throws; it filters bad rows ─────────────────────
{
  assert.deepEqual(loadTargets("/nonexistent/wol.json"), [], "missing file is normal");

  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "wol-"));

  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  assert.deepEqual(loadTargets(bad), [], "malformed file is ignored, not fatal");

  const mixed = path.join(dir, "mixed.json");
  writeFileSync(
    mixed,
    JSON.stringify({
      targets: [
        { name: "good", mac: "AA:BB:CC:DD:EE:FF" },
        { name: "broadcast", mac: "FF:FF:FF:FF:FF:FF" }, // refused
        { name: "", mac: "001122334455" },               // nameless: unusable
        { mac: "001122334456" },                          // nameless: unusable
        { name: "nob", mac: "nope" },                     // bad mac
      ],
    }),
  );
  const loaded = loadTargets(mixed);
  assert.equal(loaded.length, 1, "only the valid row survives");
  assert.equal(loaded[0].name, "good");
  assert.equal(loaded[0].mac, "aabbccddeeff");
  passes("targets file: missing/malformed tolerated, invalid rows dropped");
}

// ── Broadcast address comes from the interface's own netmask ──────────
{
  const ifaces = {
    lo: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }],
    eth0: [{ family: "IPv4", internal: false, address: "192.168.1.42", netmask: "255.255.255.0" }],
    wlan0: [{ family: "IPv4", internal: false, address: "10.8.0.6", netmask: "255.255.0.0" }],
    eth1: [{ family: "IPv6", internal: false, address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::" }],
  };
  const addrs = broadcastAddresses(ifaces);
  // /24 → .255 in the last octet; /16 → .255.255 — the host bits, not the network bits.
  assert.deepEqual(addrs.slice(0, 2), ["192.168.1.255", "10.8.255.255"], "directed broadcasts first");
  assert.equal(addrs.at(-1), "255.255.255.255", "limited broadcast is the fallback");
  assert.ok(!addrs.includes("127.255.255.255"), "loopback is skipped");
  passes("broadcast: per-interface /24 and /16 maths, loopback and IPv6 skipped");
}

// ── Handler: success path sends the right bytes to the right place ────
function makeSender(impl) {
  const calls = [];
  const send = async ({ address, port, packet }) => {
    calls.push({ address, port, packet });
    return impl ? impl({ address, port }) : { ok: true };
  };
  send.calls = calls;
  return send;
}

{
  const send = makeSender();
  const tool = createWolTool({
    send,
    targets: [],
    interfaces: () => ({ eth0: [{ family: "IPv4", internal: false, address: "192.168.1.5", netmask: "255.255.255.0" }] }),
  });
  const result = await tool.handler({ mac: "AA:BB:CC:DD:EE:FF" });

  assert.notEqual(result.isError, true, "a sent packet is success");
  assert.equal(send.calls.length, 1);
  assert.equal(send.calls[0].address, "192.168.1.255");
  assert.equal(send.calls[0].port, 9, "port 9 first");
  assert.equal(send.calls[0].packet.length, 102);
  assert.deepEqual([...send.calls[0].packet.subarray(0, 6)], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  // The result must not claim the machine woke. UDP send success is not delivery.
  assert.match(result.content[0].text, /accepted the packet for sending, nothing more/);
  assert.match(result.content[0].text, /unacknowledged/);
  passes("handler: one packet, to the subnet broadcast, on port 9, with honest wording");
}

// ── Handler: falls back across port and address, stops at first success ─
{
  // Port 9 fails everywhere, port 7 works on the second address.
  const send = makeSender(({ address, port }) =>
    port === 7 && address === "255.255.255.255" ? { ok: true } : { ok: false, error: "EACCES" },
  );
  const tool = createWolTool({
    send,
    targets: [],
    interfaces: () => ({}),
  });
  const result = await tool.handler({ mac: "AA:BB:CC:DD:EE:FF" });
  assert.notEqual(result.isError, true);
  const tried = send.calls.map((c) => `${c.address}:${c.port}`);
  assert.deepEqual(tried, ["255.255.255.255:9", "255.255.255.255:7"], "stops as soon as one lands");
  passes("handler: retries the other port, stops at the first accepted send");
}

// ── Handler: total failure is an MCP error, never a rejected promise ──
{
  const send = makeSender(() => ({ ok: false, error: "ENETUNREACH" }));
  const tool = createWolTool({ send, targets: [], interfaces: () => ({}) });
  const result = await tool.handler({ mac: "AA:BB:CC:DD:EE:FF" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /ENETUNREACH/, "surfaces the real socket error");
  assert.match(result.content[0].text, /another subnet/, "explains the usual cause");
  passes("handler: every send failing yields isError + actionable text, no throw");
}

// ── Handler: bad input never opens a socket ───────────────────────────
for (const args of [undefined, {}, { mac: "" }, { mac: "nope" }, { target: "unknown" }]) {
  const send = makeSender();
  const tool = createWolTool({ send, targets: [], interfaces: () => ({}) });
  const result = await tool.handler(args);
  assert.equal(result.isError, true, `must reject ${JSON.stringify(args)}`);
  assert.equal(send.calls.length, 0, "no packet for invalid input");
}
passes("handler: invalid input is refused before any packet is built");

// ── A sender that throws is caught, not propagated ────────────────────
{
  const tool = createWolTool({
    send: async () => {
      throw new Error("boom");
    },
    targets: [],
    interfaces: () => ({}),
  });
  let thrown;
  try {
    await tool.handler({ mac: "AA:BB:CC:DD:EE:FF" });
  } catch (e) {
    thrown = e;
  }
  assert.match(String(thrown?.message), /boom/, "an injected sender that throws is surfaced loudly");
  passes("handler: a throwing test double is visible (real sender never throws)");
}

console.log("wol-tool.test.mjs: ALL PASS");
