import { describe, expect, it, mock, spyOn } from "bun:test"
import type { ChatChunk } from "./openrouter"
import { streamChat, verifyKey } from "./openrouter"

const context = describe

const streamResponse = (chunks: string[]): Response => {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(new TextEncoder().encode(chunk))
            }
            controller.close()
        }
    })
    return new Response(body, { status: 200 })
}

const collect = async (stream: AsyncGenerator<ChatChunk>): Promise<ChatChunk[]> => {
    const out: ChatChunk[] = []
    for await (const chunk of stream) {
        out.push(chunk)
    }
    return out
}

const textValues = (chunks: ChatChunk[]): string[] =>
    chunks
        .filter((chunk): chunk is { type: "text"; value: string } => chunk.type === "text")
        .map((chunk) => chunk.value)

describe("openrouter", () => {
    context("streamChat", () => {
        it("yields content deltas in order", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse([
                    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
                    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
                    "data: [DONE]\n\n"
                ])
            )

            const chunks = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            expect(textValues(chunks)).toEqual(["Hel", "lo"])
        })

        it("parses a single SSE event split across two reads", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse(['data: {"choices":[{"delta":{"content":"Hi', '"}}]}\n\ndata: [DONE]\n\n'])
            )

            const chunks = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            expect(textValues(chunks)).toEqual(["Hi"])
        })

        it("targets the overridden base URL", async () => {
            let calledUrl = ""
            global.fetch = mock(async (url: string) => {
                calledUrl = url
                return streamResponse(["data: [DONE]\n\n"])
            }) as unknown as typeof fetch

            await collect(
                streamChat({
                    apiKey: "k",
                    baseUrl: "https://api.openai.com/v1",
                    messages: [{ role: "user", content: "hi" }]
                })
            )

            expect(calledUrl).toBe("https://api.openai.com/v1/chat/completions")
        })

        it("calls onOpen once when the first chunk arrives", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse([
                    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
                    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
                    "data: [DONE]\n\n"
                ])
            )

            let opened = 0
            await collect(
                streamChat({
                    apiKey: "k",
                    messages: [{ role: "user", content: "hi" }],
                    onOpen: () => {
                        opened++
                    }
                })
            )

            expect(opened).toBe(1)
        })

        it("reassembles tool-call arguments split across two SSE lines into one ToolCall", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse([
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"resize","arguments":"{\\"sca"}}]}}]}\n\n',
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"le\\":2}"}}]}}]}\n\n',
                    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
                    "data: [DONE]\n\n"
                ])
            )

            const chunks = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            expect(chunks).toEqual([
                {
                    type: "tool_calls",
                    calls: [{ id: "call_1", type: "function", function: { name: "resize", arguments: '{"scale":2}' } }]
                }
            ])
        })

        it("yields exactly one tool_calls chunk when the stream finishes with tool_calls", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse([
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"noop","arguments":"{}"}}]}}]}\n\n',
                    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
                    "data: [DONE]\n\n"
                ])
            )

            const chunks = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            const toolChunks = chunks.filter((chunk) => chunk.type === "tool_calls")
            expect(toolChunks).toHaveLength(1)
        })

        it("yields ordered text chunks and no tool_calls for plain content", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse([
                    'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
                    'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
                    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
                    "data: [DONE]\n\n"
                ])
            )

            const chunks = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            expect(textValues(chunks)).toEqual(["a", "b"])
            expect(chunks.some((chunk) => chunk.type === "tool_calls")).toBe(false)
        })

        it("assembles two parallel tool calls into two ToolCalls", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse([
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"first","arguments":"{\\"x\\":"}}]}}]}\n\n',
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"second","arguments":"{\\"y\\":"}}]}}]}\n\n',
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
                    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"2}"}}]}}]}\n\n',
                    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
                    "data: [DONE]\n\n"
                ])
            )

            const chunks = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            expect(chunks).toEqual([
                {
                    type: "tool_calls",
                    calls: [
                        { id: "call_a", type: "function", function: { name: "first", arguments: '{"x":1}' } },
                        { id: "call_b", type: "function", function: { name: "second", arguments: '{"y":2}' } }
                    ]
                }
            ])
        })
    })

    context("verifyKey", () => {
        it("returns the key label from /key on OpenRouter", async () => {
            let calledUrl = ""
            global.fetch = mock(async (url: string) => {
                calledUrl = url
                return { ok: true, json: async () => ({ data: { label: "my-key" } }) }
            }) as unknown as typeof fetch

            const info = await verifyKey("k")

            expect(calledUrl).toBe("https://openrouter.ai/api/v1/key")
            expect(info).toEqual({ label: "my-key" })
        })

        it("falls back to /models for non-OpenRouter base URLs", async () => {
            let calledUrl = ""
            global.fetch = mock(async (url: string) => {
                calledUrl = url
                return { ok: true, json: async () => ({ data: [{}, {}, {}] }) }
            }) as unknown as typeof fetch

            const info = await verifyKey("k", "https://api.openai.com/v1")

            expect(calledUrl).toBe("https://api.openai.com/v1/models")
            expect(info).toEqual({ label: "3 models available" })
        })

        it("throws on a 401", async () => {
            global.fetch = mock(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch

            let error: unknown
            try {
                await verifyKey("k")
            } catch (caught) {
                error = caught
            }

            expect(error).toBeInstanceOf(Error)
        })
    })
})
