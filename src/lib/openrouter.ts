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

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }
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

/**
 * Stream a chat completion, yielding content deltas as they arrive.
 *
 * Server-sent events are parsed by buffering across reads: the buffer is split
 * on newlines and the trailing (possibly partial) segment is kept for the next
 * read so an event split across chunks still parses. An empty `baseUrl`/`model`
 * resolves to the default.
 */
export async function* streamChat(opts: {
    apiKey: string
    baseUrl?: string
    model?: string
    messages: ChatMessage[]
    signal?: AbortSignal
    onOpen?: () => void
}): AsyncGenerator<string> {
    const response = await fetch(`${opts.baseUrl || DEFAULT_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: opts.model || DEFAULT_MODEL,
            messages: opts.messages,
            stream: true
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
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
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
                    return
                }
                const delta = (
                    JSON.parse(payload) as {
                        choices?: { delta?: { content?: string } }[]
                    }
                ).choices?.[0]?.delta?.content
                if (typeof delta === "string" && delta.length > 0) {
                    yield delta
                }
            }
        }
    } finally {
        reader.releaseLock()
    }
}
