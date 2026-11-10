# Your first task

> **Last reviewed:** 2026-11-10.

This walks the first-run setup and one real task end to end. Have a phone with the APK installed
and an API key from any supported AI provider.

## 1. First launch

The setup wizard is a sequence of steps; each one ends when its check passes.

| Step | What to do |
|---|---|
| **Welcome** | Nothing to decide; watch the animation if you like |
| **Sign-in** | Optional on debug builds. Signing in with Google links the install to an account so the owner's block/kill controls can identify it. **Skip** is fine |
| **Accessibility service** | The core permission. Android hides it for sideloaded apps: open the app's info page, tap the ⋮ menu, **Allow restricted settings**, then enable the service. The wizard shows these exact taps |
| **Display over other apps** | The overlay, the pause pill and the tap highlights |
| **Microphone** | Voice input and the wake word |
| **Notifications** | Run progress and the "AURA is working" chip |
| **Keyboard** | Optional. Lets AURA type into fields that refuse the accessibility path |
| **AI provider** | Pick one, paste a key, **Fetch models**, choose a model, **Save** |
| **Wake word** | Optional. "Wake up AURA" |

> **Android 17+ with Advanced Protection on:** the system only grants accessibility to services
> that declare themselves accessibility tools. AURA declares `isAccessibilityTool="true"`, so it
> is unaffected — but if a phone still refuses the grant, turn Advanced Protection off for the
> setup, which is the system's rule, not AURA's.

## 2. Pick a provider and a model

**Settings → Agent Brain.** The list includes OpenAI, Anthropic, Google Gemini, OpenRouter, Groq,
Mistral, DeepSeek, xAI, and any custom OpenAI-compatible endpoint you add.

Two practical notes from real runs:

- **Pick a visual model if you can.** Screen grids cover most tasks, but a model that can read a
  screenshot handles unlabelled icons and layout questions far better.
- **Reasoning models are slower but steadier** on multi-step app navigation. A fast small model
  often gets lost after three screens.

Your key is stored on the phone and sent only to that provider. AURA has no server of its own.

## 3. Run something

Open the assistant: tap the app, press **both volume keys** together, use the assistant gesture, or
say **"Wake up AURA"** if the wake word is on. Then type or speak:

> Message Priya on WhatsApp that I'll be ten minutes late.

Watch what happens:

- A status pill narrates each step in plain language: *Reading the screen…*, *Opening WhatsApp…*,
  *Typing…*
- A highlight flashes where AURA taps, so you can follow along.
- Tapping a run opens the trace: every tool call, its arguments, its result, and the model's
  reasoning between them.

## 4. Stop it at any time

| To | Do this |
|---|---|
| Pause, and decide later | Tap the pill, say "stop", or just pick the phone up |
| Resume | Say "continue" |
| Abandon | Say "drop it", or tap **Cancel** on the paused pill |

A pause is a checkpoint, not a loss: AURA remembers where it was, and the run report shows what it
did and what is left.

## 5. What a good task looks like

AURA is strongest when the goal names the app and the outcome:

| Instead of | Say |
|---|---|
| "Order food" | "Order a chicken biryani on Swiggy to my home address" |
| "Find coffee" | "Find the nearest Café Coffee Day on Maps and start directions" |
| "Change my settings" | "Turn on dark mode and reduce brightness to 40%" |

Anything with an unavoidable choice — *which* of two cards, *which* seat — triggers a question card
rather than a guess.

## 6. When it goes wrong

Read the run report first. It says which step failed and why. Then see
[Troubleshooting](../troubleshooting.md).
