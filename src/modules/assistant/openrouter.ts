/**
 * Minimal client for OpenAI-compatible chat APIs (OpenRouter, OpenAI, or any
 * compatible endpoint).
 *
 * Frontend-only: these helpers call the provider directly from the browser with
 * the user's key. The base URL is overridable so the same UI can target
 * OpenRouter, OpenAI, or a local/compatible server. Both accept an optional
 * `AbortSignal` forwarded to `fetch` so callers own cancellation, and both throw
 * on a non-OK response (the status is included) — callers own the try/catch.
 * `streamChat` owns the reader it locks and releases it in a `finally`.
 */

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6" // OpenRouter model slug; user-overridable

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } }
export type ChatMessage =
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
    | { role: "tool"; tool_call_id: string; content: string }
export type ChatChunk = { type: "text"; value: string } | { type: "tool_calls"; calls: ToolCall[] }
export type ConnectionInfo = { label: string }

/**
 * Verify the key + base URL are usable, returning a short label to display.
 *
 * OpenRouter exposes `GET /key` (validates the key, returns its name). Other
 * OpenAI-compatible providers don't, so we fall back to `GET /models`: on OpenAI
 * that validates the key (401 on a bad one); on OpenRouter `/models` is
 * unauthenticated, so there the `/key` path is preferred. An empty `baseUrl`
 * resolves to the default.
 */
export const verifyKey = async (apiKey: string, baseUrl?: string, signal?: AbortSignal): Promise<ConnectionInfo> => {
    const base = baseUrl || DEFAULT_BASE_URL
    const headers = { Authorization: `Bearer ${apiKey}` }

    if (base.includes("openrouter.ai")) {
        const response = await fetch(`${base}/key`, { headers, signal })
        if (!response.ok) {
            throw new Error(`Failed to verify key (${response.status})`)
        }
        const { data } = (await response.json()) as { data: { label: string } }
        return { label: data.label || "key valid" }
    }

    const response = await fetch(`${base}/models`, { headers, signal })
    if (!response.ok) {
        throw new Error(`Failed to verify key (${response.status})`)
    }
    const { data } = (await response.json()) as { data: unknown[] }
    return { label: `${data.length} models available` }
}

/** A tool call being assembled across streamed fragments (arguments arrive in pieces). */
type ToolCallAccumulator = { id: string; name: string; arguments: string }

/** Order accumulated tool calls by their stream index and freeze into the wire shape. */
const assembleToolCalls = (acc: Map<number, ToolCallAccumulator>): ToolCall[] =>
    [...acc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments }
        }))

/**
 * Stream a chat completion, yielding text deltas and assembled tool calls as
 * they arrive.
 *
 * Server-sent events are parsed by buffering across reads: the buffer is split
 * on newlines and the trailing (possibly partial) segment is kept for the next
 * read so an event split across chunks still parses. Text deltas are yielded as
 * `{ type: "text" }`. Tool-call fragments are accumulated by their numeric
 * `index` — the first fragment carries `id` + `function.name`, later fragments
 * append `function.arguments` chunks in arrival order — and emitted exactly once
 * as `{ type: "tool_calls" }` when `finish_reason` is `"tool_calls"` (or the
 * stream ends with calls pending). `arguments` is left as the raw JSON string.
 * `tools`/`tool_choice` are sent only when `opts.tools` is non-empty. An empty
 * `baseUrl`/`model` resolves to the default.
 */
export async function* streamChat(opts: {
    apiKey: string
    baseUrl?: string
    model?: string
    messages: ChatMessage[]
    tools?: ToolDef[]
    signal?: AbortSignal
    onOpen?: () => void
}): AsyncGenerator<ChatChunk> {
    const response = await fetch(`${opts.baseUrl || DEFAULT_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: opts.model || DEFAULT_MODEL,
            messages: opts.messages,
            stream: true,
            ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {})
        }),
        signal: opts.signal
    })
    if (!response.ok) {
        throw new Error(`Chat request failed (${response.status})`)
    }
    if (!response.body) {
        throw new Error("Chat response has no body")
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    let opened = false
    const toolCalls = new Map<number, ToolCallAccumulator>()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                // Stream ended without an explicit finish_reason — flush any pending calls.
                if (toolCalls.size > 0) {
                    yield { type: "tool_calls", calls: assembleToolCalls(toolCalls) }
                }
                return
            }
            // First bytes (provider metadata / keep-alive) — the model has started responding.
            if (!opened && value) {
                opened = true
                opts.onOpen?.()
            }
            buffer += value
            const lines = buffer.split("\n")
            // Keep the last (possibly partial) segment for the next read.
            buffer = lines.pop() ?? ""
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith("data:")) {
                    continue
                }
                const payload = trimmed.slice("data:".length).trim()
                if (payload === "[DONE]") {
                    if (toolCalls.size > 0) {
                        yield { type: "tool_calls", calls: assembleToolCalls(toolCalls) }
                    }
                    return
                }
                const choice = (
                    JSON.parse(payload) as {
                        choices?: {
                            delta?: {
                                content?: string
                                tool_calls?: {
                                    index: number
                                    id?: string
                                    function?: { name?: string; arguments?: string }
                                }[]
                            }
                            finish_reason?: string
                        }[]
                    }
                ).choices?.[0]
                if (!choice) {
                    continue
                }
                const content = choice.delta?.content
                if (typeof content === "string" && content.length > 0) {
                    yield { type: "text", value: content }
                }
                for (const fragment of choice.delta?.tool_calls ?? []) {
                    const existing = toolCalls.get(fragment.index)
                    if (existing) {
                        existing.arguments += fragment.function?.arguments ?? ""
                    } else {
                        toolCalls.set(fragment.index, {
                            id: fragment.id ?? "",
                            name: fragment.function?.name ?? "",
                            arguments: fragment.function?.arguments ?? ""
                        })
                    }
                }
                if (choice.finish_reason === "tool_calls") {
                    yield { type: "tool_calls", calls: assembleToolCalls(toolCalls) }
                    return
                }
            }
        }
    } finally {
        reader.releaseLock()
    }
}
