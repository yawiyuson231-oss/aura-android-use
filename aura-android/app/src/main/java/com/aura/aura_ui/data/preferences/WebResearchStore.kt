package com.aura.aura_ui.data.preferences

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The user's "look things up on the web" switch: whether the agent may search Google and read
 * help pages, both before a task and mid-run through the `look_up` tool.
 *
 * - Contract: when off, no search runs and no page is fetched. Pre-task research is skipped
 *   entirely, and `look_up` is not offered to the model at all, so it cannot be called and
 *   cannot fail in a confusing way. Defaults to on.
 * - Reads/Writes: `aura_settings` (`web_research_enabled`).
 * - Why it exists: research sends a question derived from the task to Google, in a hidden
 *   browser, before the agent does anything else. That is a real network disclosure, so it
 *   needs a switch rather than a comment in a doc.
 * - Change together: the privacy wording in `presentation/screens/legal/LegalCopy.kt` and the
 *   "Research" note in `README.md`.
 */
object WebResearchStore {
    private const val PREFS_NAME = "aura_settings"
    private const val KEY_ENABLED = "web_research_enabled"

    private val _enabled = MutableStateFlow(true)

    /** Observed by the Settings row; read by the agent before it starts a run. */
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    private var hydrated = false

    fun hydrate(context: Context) {
        if (hydrated) return
        hydrated = true
        _enabled.value = prefs(context).getBoolean(KEY_ENABLED, true)
    }

    /**
     * Synchronous read for the agent, which runs off the main thread with no UI in scope.
     * Hydrates on first use so the value is never wrong just because no screen was shown.
     */
    fun isEnabled(context: Context): Boolean {
        hydrate(context)
        return _enabled.value
    }

    fun setEnabled(context: Context, value: Boolean) {
        hydrated = true
        _enabled.value = value
        prefs(context).edit().putBoolean(KEY_ENABLED, value).apply()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
