import { logToolEvent } from "./log"
import type { ChatChunk, ChatMessage, ToolCall } from "./openrouter"

/**
 * The dependencies a single agent turn needs, all injected so the loop stays
 * React-free and unit-testable. The caller binds apiKey/model/tools/signal into
 * `stream`, owns how a tool runs in `execute`, and decides how prose and actions
 * surface to the UI via `onText`/`onAction`.
 */
export type RunAgentTurnDeps = {
    /** Stream one model response for the running history (caller binds apiKey/model/tools/signal). */
    stream: (messages: ChatMessage[]) => AsyncGenerator<ChatChunk>
    /** Run ONE tool call and return its result content (a success string or an error message). */
    execute: (call: ToolCall) => Promise<string> | string
    /** Stream assistant prose to the UI as it arrives. */
    onText: (delta: string) => void
    /** A tool turn is about to run — the model decided to act. */
    onAction?: (calls: ToolCall[]) => void
    /** Hard cap on tool round-trips before bailing out (default 8). */
    maxSteps?: number
}

/**
 * Drive a multi-step agent turn to completion.
 *
 * Each iteration streams one model response. Text chunks accumulate into the
 * assistant message for this step and are forwarded to `onText`; a `tool_calls`
 * chunk is captured. When the stream ends with no calls the turn is prose and we
 * return — a text response ends the loop. Otherwise we record the assistant's
 * tool_calls message, run every call (pushing a `tool` message per call with its
 * result), and loop again so the model can react to the results. The loop is
 * bounded by `maxSteps`; if exhausted it returns the history as-is. Tool
 * arguments are NOT parsed here — that is `execute`'s job.
 *
 * `messages` is copied; the returned array is the grown history (system/user
 * prefix preserved, assistant + tool messages appended).
 */
export const runAgentTurn = async (messages: ChatMessage[], deps: RunAgentTurnDeps): Promise<ChatMessage[]> => {
    const maxSteps = deps.maxSteps ?? 8
    const history: ChatMessage[] = [...messages]

    for (let step = 0; step < maxSteps; step++) {
        let text = ""
        let calls: ToolCall[] | undefined
        for await (const chunk of deps.stream(history)) {
            if (chunk.type === "text") {
                text += chunk.value
                deps.onText(chunk.value)
            } else {
                calls = chunk.calls
            }
        }

        // No tool calls — the model answered in prose, so the turn is over.
        if (!calls || calls.length === 0) {
            return history
        }

        deps.onAction?.(calls)
        history.push({ role: "assistant", content: text, tool_calls: calls })
        for (const call of calls) {
            const result = await deps.execute(call)
            // Observability only — record the call's outcome without altering it.
            logToolEvent({
                step,
                name: call.function.name,
                args: call.function.arguments,
                result,
                ok: !result.startsWith("Error")
            })
            history.push({ role: "tool", tool_call_id: call.id, content: result })
        }
    }

    return history
}
