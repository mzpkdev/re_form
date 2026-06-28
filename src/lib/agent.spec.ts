import { describe, expect, it } from "bun:test"
import { runAgentTurn } from "./agent"
import type { ChatChunk, ChatMessage, ToolCall } from "./openrouter"

const context = describe

const toolCall = (id: string, name = "create_primitive", args = "{}"): ToolCall => ({
    id,
    type: "function",
    function: { name, arguments: args }
})

/** A stream that yields the given chunks once, in order, then ends. */
const streamOf = (chunks: ChatChunk[]) =>
    async function* (): AsyncGenerator<ChatChunk> {
        for (const chunk of chunks) {
            yield chunk
        }
    }

describe("runAgentTurn", () => {
    context("when the model calls a tool then replies with prose", () => {
        it("runs the tool once, streams the follow-up text, and ends with a matching tool message", async () => {
            const call = toolCall("call-1")
            const streams = [
                streamOf([{ type: "tool_calls", calls: [call] }])(),
                streamOf([{ type: "text", value: "All done." }])()
            ]
            let streamIndex = 0
            const executed: ToolCall[] = []
            const texts: string[] = []

            const history = await runAgentTurn([{ role: "user", content: "make a cube" }], {
                stream: () => streams[streamIndex++],
                execute: (c) => {
                    executed.push(c)
                    return "Applied create_primitive."
                },
                onText: (delta) => texts.push(delta)
            })

            expect(executed).toHaveLength(1)
            expect(executed[0].id).toBe("call-1")
            expect(texts).toEqual(["All done."])

            const assistant = history[history.length - 2]
            expect(assistant.role).toBe("assistant")
            expect((assistant as Extract<ChatMessage, { role: "assistant" }>).tool_calls).toEqual([call])

            const tool = history[history.length - 1]
            expect(tool.role).toBe("tool")
            expect((tool as Extract<ChatMessage, { role: "tool" }>).tool_call_id).toBe("call-1")
            expect((tool as Extract<ChatMessage, { role: "tool" }>).content).toBe("Applied create_primitive.")

            // The loop terminated: the second stream (prose) was the last one consumed.
            expect(streamIndex).toBe(2)
        })
    })

    context("when the model never stops calling tools", () => {
        it("stops after maxSteps without hanging", async () => {
            let executions = 0

            const history = await runAgentTurn([{ role: "user", content: "loop forever" }], {
                // A fresh tool-call stream every iteration — the model never yields prose.
                stream: () => streamOf([{ type: "tool_calls", calls: [toolCall(`call-${executions}`)] }])(),
                execute: () => {
                    executions++
                    return "ok"
                },
                onText: () => {},
                maxSteps: 3
            })

            expect(executions).toBe(3)
            // 3 assistant + 3 tool messages appended to the single user message.
            expect(history).toHaveLength(7)
        })
    })

    context("when the model replies with pure prose", () => {
        it("never calls execute and appends no tool messages", async () => {
            let executions = 0
            const texts: string[] = []

            const history = await runAgentTurn([{ role: "user", content: "hello" }], {
                stream: streamOf([
                    { type: "text", value: "Hi " },
                    { type: "text", value: "there." }
                ]),
                execute: () => {
                    executions++
                    return "should not run"
                },
                onText: (delta) => texts.push(delta)
            })

            expect(executions).toBe(0)
            expect(texts).toEqual(["Hi ", "there."])
            expect(history.some((m) => m.role === "tool")).toBe(false)
            expect(history).toHaveLength(1)
        })
    })
})
