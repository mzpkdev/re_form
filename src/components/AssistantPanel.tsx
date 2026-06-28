import { Bot, Send, User, X } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { cn } from "../design/cn"

type Message = {
    id: number
    role: "assistant" | "user"
    text: string
    timestamp?: string
    actioning?: boolean
}

const TYPING_DELAY_MS = 1000
const REPLY_DELAY_MS = 3000

const formatTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

const AssistantMessage = ({ text, timestamp, actioning }: Message) => (
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
                {text}
            </div>
            {timestamp ? <div className="mt-1 font-mono text-tiny text-tertiary">{timestamp}</div> : null}
        </div>
    </div>
)

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
    const [messages, setMessages] = useState<Message[]>([])
    const [draft, setDraft] = useState("")
    const [pending, setPending] = useState(false)
    const [showTyping, setShowTyping] = useState(false)
    const nextId = useRef(1)
    const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const replyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const historyRef = useRef<HTMLDivElement>(null)

    useEffect(
        () => () => {
            clearTimeout(typingTimer.current)
            clearTimeout(replyTimer.current)
        },
        []
    )

    useEffect(() => {
        const el = historyRef.current
        if (el && (messages.length > 0 || showTyping)) {
            el.scrollTop = el.scrollHeight
        }
    }, [messages, showTyping])

    const canSend = draft.trim().length > 0 && !pending

    const send = () => {
        if (!canSend) {
            return
        }
        const userId = nextId.current++
        setMessages((prev) => [
            ...prev,
            { id: userId, role: "user", text: draft.trim(), timestamp: `USER - ${formatTime()}` }
        ])
        setDraft("")
        setPending(true)
        typingTimer.current = setTimeout(() => setShowTyping(true), TYPING_DELAY_MS)
        replyTimer.current = setTimeout(() => {
            const replyId = nextId.current++
            const replyTime = formatTime()
            setMessages((prev) => [
                ...prev,
                { id: replyId, role: "assistant", text: "Hello World!", timestamp: `SYS_LOG - ${replyTime}` }
            ])
            setShowTyping(false)
            setPending(false)
        }, REPLY_DELAY_MS)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            send()
        }
    }

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
                    {messages.map((message) =>
                        message.role === "assistant" ? (
                            <AssistantMessage key={message.id} {...message} />
                        ) : (
                            <UserMessage key={message.id} {...message} />
                        )
                    )}
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
