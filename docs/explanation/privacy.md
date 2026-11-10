# Privacy: what leaves the phone

> **Last reviewed:** 2026-11-10.

There is no AURA server. The project runs one Firebase project for owner controls and diagnostics,
and nothing else. Screen content goes only to the AI provider you chose, with your key.

## Data leaving the phone

| Data | Destination | Trigger | Switch |
|---|---|---|---|
| Your request, the screen tree text, screenshots | Your AI provider (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, …) — whichever you configured | Every agent turn and every look | None: this is the product. Change provider or remove the key |
| A generic "how do I…" question; help pages read back | Google, or DuckDuckGo / Bing as fallback | Web research before a task, and `look_up` mid-task | **Settings → Privacy & Data → Web research** (default on) |
| Search queries the model wrote | Tavily | Only if you add a Tavily key | Remove the key |
| Voice audio | Groq (Whisper) or Gemini Live, with your keys | Voice input, Live mode | Type instead; leave Live mode off |
| Counts, bands, crash traces, install record with your Google email | The project's Firebase | Diagnostics on (default) | **Settings → Privacy & Data → Share diagnostics** |
| Nothing | The desktop computer | Pairing and each MCP call | Revoke in **Trusted Devices** |

**What never leaves:** your contact list (matching happens on the phone — only the matched name and
number go to the model so it can fill the field), your files, your notification history beyond what
a tool call asks for, screen content to any AURA-owned server, and your API keys, which are sent only
to the provider they belong to.

## The web research switch

Research is the one place AURA searches the web **before the agent does anything**, so it needed a
switch rather than a paragraph. With it off:

- no query is built, and no page is fetched before a task;
- `look_up` is not registered, so the model cannot call it and cannot fail on it;
- everything else is unchanged.

The question is built from a generic task phrase (`ResearchText.cleanPhrase`), the matched app's
label, the phone's name and its Android version. Quoted text and personal details are removed
before it is sent, and screen content never is. The sites involved see your IP address, as they
would for any visit.

## The diagnostics switch

Both switches default to on because they are what make the project debuggable. One tap turns
diagnostics off, and Firebase Analytics and Crashlytics stop collecting (each SDK persists that
setting across launches). Turning it off does not delete data already sent — see the in-app privacy
policy for the removal route, because the client cannot delete a registry row under the security
rules.

## Pairing a computer

A new computer needs the PIN displayed on the phone, then your approval after comparing two
6-digit codes on both screens. Pairing is bound to the DTLS fingerprints of both ends, so the code
cannot be forced by something in the middle. Reconnects prove identity with a secret that is never
sent again. The link is LAN-only: no relay, no STUN/TURN, and nothing is reachable from the
internet. `~/.aura/webrtc.json` on your computer identifies it to your phone — keep it private.

## Keys

Provider keys live in the app's storage on the phone and are sent only to their endpoint. The
Tavily key is kept in encrypted storage (`androidx.security`). There is no `.env` and no key in this
repository.

## Auditing

- **Settings → Diagnostics logs**, and **MCP → Activity Log**, list tool calls and connections on the
  phone. Session logs are retained for a configurable period.
- Every agent run keeps a full trace: each tool call, its arguments, its result, and the model's
  reasoning between calls. Reading the trace is the honest way to see what a run actually did.
- The in-app privacy policy (`presentation/screens/legal/LegalCopy.kt`) is the authoritative list
  the app ships with. If this page and that text disagree, that text wins and this page is a bug.
