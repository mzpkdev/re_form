import { useMutation } from "@tanstack/react-query"
import { Bot, Send, User, X } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { cn } from "../../design/cn"
import { Markdown } from "./Markdown"
import { type ChatMessage, streamChat } from "./openrouter"
import { Typewriter } from "./Typewriter"
import { useApiKey, useBaseUrl, useModel } from "./useApiConfig"

type Message = {
    id: number
    role: "assistant" | "user"
    text: string
    timestamp?: string
}

/**
 * A plain conversational assistant: it streams a reply and has no view of, or
 * control over, the model. No editor context is injected and no tools are sent,
 * so a single minimal system line is the only framing.
 */
const SYSTEM_MESSAGE: ChatMessage = { role: "system", content: "You are a helpful assistant." }

const formatTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

const AssistantMessage = ({ text, timestamp, complete }: Message & { complete: boolean }) => {
    // Type the raw source while streaming; once the message has both finished
    // streaming (`complete`) and finished typing (`onDone`), swap to rendered
    // Markdown. We never render Markdown mid-stream — only after settle.
    const [revealed, setRevealed] = useState(false)
    return (
        <div className="message-in flex gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center border border-primary bg-primary/10 chamfer-tr">
                <Bot className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
                <div className="border border-on-surface/10 bg-surface-container-low p-3 text-mono-data leading-relaxed break-words text-on-surface chamfer-tr">
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

export const AssistantPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
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

    const chat = useMutation({
        onMutate: () => setThinking(false),
        mutationFn: async (history: ChatMessage[]) => {
            const { signal } = controllerRef.current ?? new AbortController()
            const replyId = replyIdRef.current

            for await (const chunk of streamChat({
                apiKey,
                baseUrl,
                model,
                messages: history,
                signal,
                onOpen: () => setThinking(true)
            })) {
                // No tools are sent, so only text deltas arrive; append them to the open bubble.
                if (chunk.type === "text") {
                    setMessages((prev) =>
                        prev.map((m) => (m.id === replyId ? { ...m, text: m.text + chunk.value } : m))
                    )
                }
            }
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
            SYSTEM_MESSAGE,
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
                        // stands in for it, so don't also render an empty assistant bubble. Only
                        // the reply currently streaming is incomplete; all others are settled.
                        const complete = !chat.isPending || message.id !== replyIdRef.current
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
