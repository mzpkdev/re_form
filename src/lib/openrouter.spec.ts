import { describe, expect, it, mock, spyOn } from "bun:test"
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

const collect = async (stream: AsyncGenerator<string>): Promise<string[]> => {
    const out: string[] = []
    for await (const delta of stream) {
        out.push(delta)
    }
    return out
}

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

            const deltas = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            expect(deltas).toEqual(["Hel", "lo"])
        })

        it("parses a single SSE event split across two reads", async () => {
            spyOn(global, "fetch").mockResolvedValue(
                streamResponse(['data: {"choices":[{"delta":{"content":"Hi', '"}}]}\n\ndata: [DONE]\n\n'])
            )

            const deltas = await collect(streamChat({ apiKey: "k", messages: [{ role: "user", content: "hi" }] }))

            expect(deltas).toEqual(["Hi"])
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
