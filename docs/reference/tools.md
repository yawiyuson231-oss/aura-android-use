# Tools reference

> **Last reviewed:** 2026-11-10, against a live capture from a phone
> (`aura-android-use-website/mcp-tools-data.js`, 2026-10-29).

44 tools, exposed identically to the on-device agent and to every computer connected over MCP.
Argument names are exact; `?` marks an optional argument.

Every call is subject to the [safety guards](../explanation/safety.md) before it runs. A refusal comes
back as a normal tool result with a reason, so the model can adapt instead of retrying blindly.

## See

| Tool | Arguments | Returns |
|---|---|---|
| `perceive_screen` | `description`, `detail?` | An annotated screenshot plus every element, each with a `som_id` to target |
| `read_screen` | `changes_only?`, `query?` | The screen as a character grid of boxes, no image — cheap and usually enough |
| `get_screenshot` | — | A plain screenshot with no boxes |
| `verify_action` | `expected` | Foreground app, element count, top labels, keyboard and loading state — read-only, never acts |
| `watch_device_events` | `timeout_seconds?`, `max_events?` | Blocks, collecting accessibility events (window, content and focus changes) |
| `get_device_status` | — | Screen size, whether accessibility is on, and the foreground package |

**Which to use:** `read_screen` first (cheap), `perceive_screen` when looks matter or `read_screen`
says `ESCALATE`, `get_screenshot` for an unlabelled icon or a colour question.

## Touch

| Tool | Arguments | Notes |
|---|---|---|
| `tap` | `som_id`, `style?`, `duration_ms?` | `style`: `single` (default), `double`, `long` |
| `type_text` | `text`, `som_id?` | Types into the focused field, or the field named by `som_id` |
| `set_value` | `som_id`, `value` | A toggle to `on`/`off`, or a text field to exactly `value`, then confirms |
| `swipe` | `som_id?`, `direction?`, `strokes?`, `hold_ms?`, `x1?`, `y1?`, `x2?`, `y2?`, `duration_ms?` | Element-relative for sliders and swipe-to-act; raw coordinates also accepted |
| `scroll` | `direction`, `som_id?` | Half a screen |
| `press_enter` | — | Enter / the action key on the focused field |
| `press_key` | `key` | `back`, `home`, `recents` |
| `clipboard` | `action`, `text?` | `read` or `write` |
| `run_steps` | `steps` | Several known actions in one call, each re-verified |

## Move around

| Tool | Arguments | Notes |
|---|---|---|
| `launch_app` | `app_name?`, `package_name?`, `force?` | Opens an installed app |
| `lookup_app` | `app_name` | Best package match plus up to 10 candidates |
| `list_app_deeplinks` | `package_name` | The shortcuts an app offers, to jump straight to a screen |
| `resolve_deeplink` | `uri` | What a URI would open, without opening it |
| `open_deeplink` | `uri`, `package_name?`, `app_name?` | Jump straight to a screen instead of tapping through |
| `system_intent` | `action`, plus per-action fields (`phone_number?`, `body?`, `hour?`, `destination?`, `mode?`, `text?`, `subject?`, `title?`, `start?`, `end?`, `location?`, `notes?`, `label?`, `minute?`, `seconds?`) | Call, SMS, alarm, timer, calendar, share, navigate — with no screen navigation |

**Prefer a deep link or `system_intent` when one exists.** They skip five taps through a UI that
may change under you.

## Browser

AURA's own embedded browser, for web work that should not depend on which app is installed.

| Tool | Arguments |
|---|---|
| `browser_open` | `url`, `background?`, `session?`, `max_text_chars?`, `max_elements?` |
| `browser_read` | `session?`, `max_text_chars?`, `max_elements?` |
| `browser_act` | `action`, `el_id?`, `value?`, `generation?`, `session?`, … |
| `browser_find` | `text`, `session?`, … |
| `browser_wait` | `text?`, `timeout_ms?`, `session?`, … |
| `browser_screenshot` | `session?`, … |
| `browser_extract` | `session?`, … — repeated items (results, products) as rows plus a total |
| `browser_upload` | `el_id`, `file`, `generation?`, `session?`, … |
| `browser_tabs` | `action?`, `url?`, `index?`, `session?` |
| `browser_handoff` | `prompt?`, `check?`, `session?`, … — gives the user the screen for a step only they can do |
| `browser_close` | `session?` |

> **Google sign-in does not work in any embedded browser**, this one included. Use `browser_handoff`
> when a step needs the user.

## Notifications and media

| Tool | Arguments | Notes |
|---|---|---|
| `read_notifications` | `package_name?`, `include_ongoing?`, `limit?` | Answers "what did that app say" without touching the screen |
| `notification_action` | `key`, `action`, `reply_text?` | Press a notification button, including replying directly |
| `dismiss_notification` | `key` | Only notifications marked `is_clearable` |
| `get_media_sessions` | — | App, state, track, artist, position |
| `media_control` | `command`, `package_name?` | `play`, `pause`, `play_pause`, `next`, `previous`, `stop` |
| `volume` | `action` | `up`, `down`, `mute` |

## Contacts and files

| Tool | Arguments | Notes |
|---|---|---|
| `resolve_contact` | `name` | Matched **on the phone**; nothing is uploaded |
| `find_files` | `query?`, `kind?`, `limit?` | Newest first |
| `open_file` | `uri` | Opens in its default app |

## Check and finish

| Tool | Arguments | Notes |
|---|---|---|
| `wait_for` | `condition`, `timeout_ms?`, `expect?`, `gone?`, `poll_interval_ms?` | For downloads, uploads, ride status — waits for loading to clear |
| `end_session` | `reason?`, `outcome?`, `goal_type?` | Finishes the task and reports what happened |

`end_session` is refused if the agent changed the screen and never looked at the result, so a run
cannot report success it did not see.

## What is not a tool

`look_up` is registered for the on-device agent only, and only while
**Settings → Privacy & Data → Web research** is on. It searches Google in a hidden browser and
returns what it read. It never touches the screen, so it is not part of the MCP surface.

## Discovering the live list

The server also teaches clients how to use it — MCP **instructions** at connect time,
**resources** (its safety policy, a tool-selection guide, live device status) and **prompts**
(task templates plus any skills on the phone). Point any MCP client at it and read the tool list it
advertises; this page describes them, the server is authoritative.
