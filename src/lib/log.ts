/**
 * In-memory tool-event log for field-debuggable observability.
 *
 * The agent loop records one {@link ToolEvent} per tool call so a failed or
 * surprising geometry session can be reconstructed after the fact. Every event
 * is also mirrored to `console.debug` as a single line, so the browser console
 * is a live trace even when nobody is reading {@link getToolLog}. React-free by
 * design; the store is a module-level array, cleared per turn via
 * {@link clearToolLog}.
 */

/** One recorded tool call: its step in the loop, name, raw JSON args, result string, and pass/fail. */
export type ToolEvent = {
    /** Zero-based index of the agent loop step that issued the call. */
    step: number
    /** The tool/function name the model invoked. */
    name: string
    /** Raw JSON arguments string exactly as the model produced it. */
    args: string
    /** The execute() result content (a success string or an `Error: …` message). */
    result: string
    /** True when the call succeeded — derived from the result not starting with "Error". */
    ok: boolean
}

/** The append-only store of events for the current session/turn. */
const events: ToolEvent[] = []

/**
 * Record one tool event: push it onto the store and mirror it to `console.debug`
 * as a single line so the console is a live trace.
 */
export const logToolEvent = (event: ToolEvent): void => {
    events.push(event)
    console.debug(`[tool] #${event.step} ${event.name} ${event.ok ? "ok" : "ERR"} — ${event.result}`)
}

/** The recorded events in insertion order. Read-only — callers must not mutate the store. */
export const getToolLog = (): readonly ToolEvent[] => events

/** Drop every recorded event. Call at the start of a turn to scope the log to it. */
export const clearToolLog = (): void => {
    events.length = 0
}
