import { useMutation } from "@tanstack/react-query"
import { Bot, Send, User, X } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { cn } from "../design/cn"
import { useApiKey, useBaseUrl, useModel } from "../hooks/useApiConfig"
import { runAgentTurn } from "../lib/agent"
import { applyEdit, EDIT_TOOLS } from "../lib/edits"
import { initManifold } from "../lib/manifold"
import type { Transform, Vec3 } from "../lib/model"
import { getManifold, setManifold } from "../lib/modelStore"
import { type ChatMessage, streamChat, type ToolCall, type ToolDef } from "../lib/openrouter"
import { buildSculpt, SCULPT_TOOL, type SculptScene } from "../lib/sculpt"
import { Markdown } from "./Markdown"
import { Typewriter } from "./Typewriter"

type Message = {
    id: number
    role: "assistant" | "user"
    text: string
    timestamp?: string
    actioning?: boolean
}

/**
 * The transform tool the assistant uses to position/orient/scale the whole model
 * (separate from the CSG edit vocabulary, which reshapes geometry). Omitted
 * fields leave that component of the current transform unchanged.
 */
const SET_TRANSFORM_TOOL: ToolDef = {
    type: "function",
    function: {
        name: "set_transform",
        description:
            "Set the model's overall placement: position (mm), rotation (degrees, applied x→y→z), and uniform/per-axis scale. Each field is a [x, y, z] array. Omit a field to leave it unchanged. This moves the whole model — use the CSG tools to change its shape.",
        parameters: {
            type: "object",
            properties: {
                position: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 3,
                    maxItems: 3,
                    description: "Translation [x, y, z] in millimetres."
                },
                rotation: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 3,
                    maxItems: 3,
                    description: "Rotation [x, y, z] in degrees."
                },
                scale: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 3,
                    maxItems: 3,
                    description: "Scale factor [x, y, z] (1 = unchanged)."
                }
            },
            additionalProperties: false
        }
    }
}

const tools: ToolDef[] = [...EDIT_TOOLS, SET_TRANSFORM_TOOL, SCULPT_TOOL]

/** A [x, y, z] number triple from the arg bag, or undefined when absent/malformed. */
const triple = (value: unknown): Vec3 | undefined => {
    if (!Array.isArray(value) || value.length !== 3) {
        return undefined
    }
    if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) {
        return undefined
    }
    return [value[0], value[1], value[2]]
}

/**
 * Describe the live model for the system prompt so the assistant knows what it is
 * editing — its bounding box and volume, or that the canvas is empty.
 */
const describeModel = (): string => {
    const m = getManifold()
    if (!m) {
        return "No model loaded yet — use create_primitive to start."
    }
    const box = m.boundingBox()
    const min = box.min.map((n) => n.toFixed(1)).join(", ")
    const max = box.max.map((n) => n.toFixed(1)).join(", ")
    return `Current model: bounding box min [${min}] mm, max [${max}] mm, volume ${m.volume().toFixed(1)} mm³.`
}

const buildSystemMessage = (): ChatMessage => ({
    role: "system",
    content: [
        "You are a CAD assistant that edits a single 3D solid. All units are millimetres.",
        "To change the model, call the provided tools — never describe edits you did not make.",
        "Use create_primitive to start a new solid; add/cut/intersect_primitive and drill_hole to reshape it; set_transform to place the whole model.",
        describeModel()
    ].join(" ")
})

const formatTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

const AssistantMessage = ({ text, timestamp, actioning, complete }: Message & { complete: boolean }) => {
    // Type the raw source while streaming; once the message has both finished
    // streaming (`complete`) and finished typing (`onDone`), swap to rendered
    // Markdown. We never render Markdown mid-stream — only after settle.
    const [revealed, setRevealed] = useState(false)
    return (
        <div className="message-in flex gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center border border-primary bg-primary/10 chamfer-tr">
                <Bot className="size-4 text-primary" />
            </div>
            <div>
                <div
                    className={cn(
                        "border border-on-surface/10 bg-surface-container-low p-3 text-mono-data leading-relaxed text-on-surface chamfer-tr",
                        actioning && "border-l-2 border-l-primary"
                    )}
                >
                    {complete && revealed ? (
                        <Markdown>{text}</Markdown>
                    ) : (
                        <Typewriter text={text} onDone={complete ? () => setRevealed(true) : undefined} />
                    )}
                </div>
                {timestamp ? <div className="mt-1 font-mono text-tiny text-tertiary">{timestamp}</div> : null}
            </div>
        </div>
    )
}

const UserMessage = ({ text, timestamp }: Message) => (
    <div className="message-in flex flex-row-reverse gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-inverse-surface">
            <User className="size-4 text-surface" />
        </div>
        <div className="flex flex-col items-end">
            <div className="bg-inverse-surface p-3 text-mono-data leading-relaxed text-on-secondary chamfer">
                {text}
            </div>
            {timestamp ? <div className="mt-1 font-mono text-tiny text-tertiary">{timestamp}</div> : null}
        </div>
    </div>
)

const TypingIndicator = () => (
    <div className="message-in flex gap-3" role="status" aria-label="AI is working on a response">
        <div className="flex size-8 shrink-0 items-center justify-center border border-primary bg-primary/10 chamfer-tr">
            <Bot className="size-4 text-primary" />
        </div>
        <div className="flex items-center border border-on-surface/10 bg-surface-container-low p-3 chamfer-tr">
            <span className="typing-dots">
                <span />
                <span />
                <span />
            </span>
        </div>
    </div>
)

export const AssistantPanel = ({
    open,
    onClose,
    transform,
    onTransformChange
}: {
    open: boolean
    onClose: () => void
    transform: Transform
    onTransformChange: (t: Transform) => void
}) => {
    const { apiKey } = useApiKey()
    const { baseUrl } = useBaseUrl()
    const { model } = useModel()
    const [messages, setMessages] = useState<Message[]>([])
    const [draft, setDraft] = useState("")
    const [thinking, setThinking] = useState(false)
    const nextId = useRef(1)
    const replyIdRef = useRef(0)
    const controllerRef = useRef<AbortController | undefined>(undefined)
    const historyRef = useRef<HTMLDivElement>(null)
    // Mirror the latest transform so the execute closure (created once per
    // mutation) merges set_transform deltas over the current value, not a stale one.
    const transformRef = useRef(transform)
    transformRef.current = transform

    const chat = useMutation({
        onMutate: () => setThinking(false),
        mutationFn: async (history: ChatMessage[]) => {
            const { signal } = controllerRef.current ?? new AbortController()

            // Append a streamed delta to the assistant bubble that is currently open.
            const onText = (delta: string) => {
                const replyId = replyIdRef.current
                setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: m.text + delta } : m)))
            }

            // A tool turn is starting: flag the open bubble as actioning, then open a
            // fresh bubble so the next turn's prose streams into its own message.
            const onAction = () => {
                const closingId = replyIdRef.current
                const freshId = nextId.current++
                replyIdRef.current = freshId
                setMessages((prev) => [
                    ...prev.map((m) => (m.id === closingId ? { ...m, actioning: true } : m)),
                    { id: freshId, role: "assistant", text: "", timestamp: `SYS_LOG - ${formatTime()}` }
                ])
            }

            const execute = async (call: ToolCall): Promise<string> => {
                let args: unknown
                try {
                    args = JSON.parse(call.function.arguments)
                } catch {
                    return "Error: arguments were not valid JSON"
                }
                const name = call.function.name
                if (name === "set_transform") {
                    const a = args as Record<string, unknown>
                    const current = transformRef.current
                    const merged: Transform = {
                        position: triple(a.position) ?? current.position,
                        rotation: triple(a.rotation) ?? current.rotation,
                        scale: triple(a.scale) ?? current.scale
                    }
                    onTransformChange(merged)
                    return "Transform updated."
                }
                const wasm = await initManifold()
                if (name === "sculpt") {
                    try {
                        const scene = args as SculptScene
                        const next = buildSculpt(wasm, scene)
                        setManifold(next)
                        return `Sculpted a shape with ${scene.parts.length} parts; volume ${next.volume().toFixed(1)} mm³.`
                    } catch (error) {
                        return `Error: ${(error as Error).message}`
                    }
                }
                try {
                    const next = applyEdit(wasm, getManifold(), name, args)
                    setManifold(next)
                    return `Applied ${name}. Volume now ${next.volume().toFixed(1)} mm³.`
                } catch (error) {
                    return `Error: ${(error as Error).message}`
                }
            }

            const stream = (msgs: ChatMessage[]) =>
                streamChat({
                    apiKey,
                    baseUrl,
                    model,
                    messages: msgs,
                    tools,
                    signal,
                    onOpen: () => setThinking(true)
                })

            await runAgentTurn(history, { stream, execute, onText, onAction })
        },
        onError: (error) => {
            if (error.name === "AbortError") {
                return
            }
            const replyId = replyIdRef.current
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: `⚠ ${error.message}` } : m)))
        },
        onSettled: () => setThinking(false)
    })

    useEffect(
        () => () => {
            controllerRef.current?.abort()
        },
        []
    )

    useEffect(() => {
        if (!open) {
            controllerRef.current?.abort()
        }
    }, [open])

    useEffect(() => {
        const el = historyRef.current
        if (el && messages.length > 0) {
            el.scrollTop = el.scrollHeight
        }
    }, [messages])

    const canSend = draft.trim().length > 0 && !chat.isPending && apiKey.trim().length > 0

    const send = () => {
        if (!canSend) {
            return
        }
        const userText = draft.trim()
        const userId = nextId.current++
        const replyId = nextId.current++
        const history: ChatMessage[] = [
            buildSystemMessage(),
            ...messages.map((m) => ({ role: m.role, content: m.text })),
            { role: "user", content: userText }
        ]
        setMessages((prev) => [
            ...prev,
            { id: userId, role: "user", text: userText, timestamp: `USER - ${formatTime()}` },
            { id: replyId, role: "assistant", text: "", timestamp: `SYS_LOG - ${formatTime()}` }
        ])
        setDraft("")
        replyIdRef.current = replyId
        controllerRef.current = new AbortController()
        chat.mutate(history)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            send()
        }
    }

    const replyText = messages.find((m) => m.id === replyIdRef.current)?.text
    // `thinking` flips true when the stream opens (first provider bytes) and false
    // when it settles; hide the dots once the first real token has landed.
    const showTyping = thinking && !replyText

    return (
        <aside
            className={cn(
                "h-full shrink-0 overflow-hidden border-on-surface/10 transition-all duration-300 ease-snappy",
                open ? "w-panel border-l" : "w-0"
            )}
        >
            <div
                className={cn(
                    "flex h-full w-panel flex-col bg-surface transition duration-300 ease-snappy",
                    open ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
                )}
            >
                <div className="flex items-center justify-between border-b border-on-surface/10 bg-surface-container-low p-4">
                    <div className="flex items-center gap-2">
                        <Bot className="size-5 text-primary" />
                        <h3 className="font-mono text-title-md text-on-surface">AI ASSISTANT</h3>
                    </div>
                    <button type="button" onClick={onClose} className="text-tertiary hover:text-on-surface">
                        <X className="size-5" />
                    </button>
                </div>

                <div ref={historyRef} className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 font-sans">
                    {apiKey.trim() ? null : (
                        <div className="text-mono-data text-tertiary">
                            Add your OpenRouter key in Settings to start chatting.
                        </div>
                    )}
                    {messages.map((message) => {
                        if (message.role === "user") {
                            return <UserMessage key={message.id} {...message} />
                        }
                        // Until the first delta lands the reply is empty — the TypingIndicator
                        // stands in for it, so don't also render an empty assistant bubble.
                        // `complete`: while the turn is pending only the still-streaming final
                        // bubble is incomplete (intermediate ones are already `actioning`);
                        // once it settles `isPending` is false so all are complete.
                        const complete = !chat.isPending || !!message.actioning
                        return message.text ? (
                            <AssistantMessage key={message.id} {...message} complete={complete} />
                        ) : null
                    })}
                    {showTyping ? <TypingIndicator /> : null}
                </div>

                <div className="border-t border-on-surface/10 bg-surface p-4">
                    <div className="flex items-end gap-2">
                        <textarea
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder="Enter command or query…"
                            className="h-14 w-full resize-none rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-3 py-3 font-sans text-on-surface placeholder:text-tertiary focus:border-primary focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={send}
                            disabled={!canSend}
                            className="flex h-14 w-14 shrink-0 items-center justify-center border border-transparent bg-primary text-on-primary transition chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Send className="size-5" />
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    )
}
