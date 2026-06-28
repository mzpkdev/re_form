import { Bot, ChevronLeft, Eye, EyeOff } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "../design/cn"

const SECTIONS = [{ icon: Bot, label: "AI Assistant", active: true }]

const DEFAULT_STATUS = "Stored locally in your browser — never sent to our servers."

export const SettingsView = ({ onClose }: { onClose: () => void }) => {
    const [apiKey, setApiKey] = useState("")
    const [visible, setVisible] = useState(false)
    const [status, setStatus] = useState<{ text: string; tone: "muted" | "accent" }>({
        text: DEFAULT_STATUS,
        tone: "muted"
    })
    const testTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => () => clearTimeout(testTimer.current), [])

    const test = () => {
        setStatus({ text: "Testing…", tone: "muted" })
        testTimer.current = setTimeout(() => {
            setStatus({ text: apiKey.trim() ? "✓ Connection OK" : "Enter an API key first", tone: "accent" })
        }, 600)
    }

    return (
        <div className="flex min-h-0 flex-1">
            <aside className="flex h-full w-sidebar flex-col border-r border-on-surface/10 bg-surface">
                <div className="border-b border-on-surface/10 bg-primary p-6">
                    <div className="mb-1 font-mono text-label-caps uppercase tracking-widest text-on-primary/70">
                        SYSTEM
                    </div>
                    <h2 className="font-mono text-xl font-semibold text-on-primary">SETTINGS</h2>
                </div>
                <nav className="flex flex-1 flex-col gap-2 py-4">
                    {SECTIONS.map(({ icon: Icon, label, active }) => (
                        <button
                            key={label}
                            type="button"
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "flex items-center gap-4 border-l-4 px-6 py-4 font-mono text-label-caps transition-colors",
                                active
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-transparent text-on-surface-variant hover:bg-surface-container hover:text-primary"
                            )}
                        >
                            <Icon className="size-5" />
                            {label}
                        </button>
                    ))}
                </nav>
                <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center gap-2 border-t border-on-surface/10 px-6 py-4 font-mono text-label-caps text-on-surface-variant transition-colors hover:text-primary"
                >
                    <ChevronLeft className="size-4" />
                    Back to editor
                </button>
            </aside>

            <section className="flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-settings flex-col gap-8 p-6">
                    <div className="flex flex-col gap-4">
                        <div>
                            <h3 className="font-mono text-xl font-semibold text-on-surface">AI Assistant</h3>
                            <p className="mt-1 font-sans text-body-sm text-tertiary">
                                Connect a model provider to power the in-editor assistant.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="font-sans text-body-sm text-on-surface">API key</span>
                            <div className="flex items-center gap-2">
                                <input
                                    type={visible ? "text" : "password"}
                                    value={apiKey}
                                    onChange={(event) => setApiKey(event.target.value)}
                                    placeholder="sk-ant-api03-…"
                                    className="w-full rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2.5 py-2 font-mono text-mono-data text-on-surface placeholder:text-tertiary focus:border-primary focus:outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setVisible((v) => !v)}
                                    aria-label={visible ? "Hide API key" : "Show API key"}
                                    className="flex size-10 shrink-0 items-center justify-center border border-on-surface/20 text-tertiary transition-colors hover:text-on-surface"
                                >
                                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                </button>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span
                                    className={cn(
                                        "font-mono text-tiny",
                                        status.tone === "accent" ? "text-primary" : "text-tertiary"
                                    )}
                                >
                                    {status.text}
                                </span>
                                <button
                                    type="button"
                                    onClick={test}
                                    className="shrink-0 border border-primary px-3 py-1 font-mono text-label-caps text-primary transition-colors hover:bg-surface-container"
                                >
                                    Test connection
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}
