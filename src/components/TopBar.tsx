import { ChevronDown, Download, Settings, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "../design/cn"

type View = "editor" | "settings" | "draw"

export const TopBar = ({
    view,
    onNavigate,
    onImport,
    onExport
}: {
    view: View
    onNavigate: (view: View) => void
    onImport: (file: File) => void
    onExport?: () => void
}) => {
    const [fileMenuOpen, setFileMenuOpen] = useState(false)
    const fileRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const openImport = () => inputRef.current?.click()

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") {
                event.preventDefault()
                inputRef.current?.click()
            }
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [])

    useEffect(() => {
        if (!fileMenuOpen) {
            return
        }
        const onMouseDown = (event: MouseEvent) => {
            if (fileRef.current && !fileRef.current.contains(event.target as Node)) {
                setFileMenuOpen(false)
            }
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setFileMenuOpen(false)
            }
        }
        document.addEventListener("mousedown", onMouseDown)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("mousedown", onMouseDown)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [fileMenuOpen])

    const closeAfter = (action: () => void) => () => {
        action()
        setFileMenuOpen(false)
    }

    return (
        <header className="flex h-toolbar items-center justify-between border-b border-on-surface/10 bg-surface px-6 text-on-surface">
            <input
                ref={inputRef}
                type="file"
                accept=".stl,model/stl"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) {
                        onImport(file)
                    }
                    event.target.value = ""
                }}
            />
            <div className="flex items-center gap-8">
                <h1 className="font-mono text-2xl font-bold uppercase tracking-tighter text-on-surface">
                    RE_FORM_V1.0
                </h1>
                <nav className="flex items-center gap-6">
                    <div className="relative" ref={fileRef}>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                setFileMenuOpen((open) => !open)
                            }}
                            className={cn(
                                "flex items-center gap-1 text-sm font-medium transition-colors",
                                fileMenuOpen ? "text-primary" : "text-on-surface-variant hover:text-primary"
                            )}
                        >
                            File
                            <ChevronDown className="size-5" />
                        </button>
                        {fileMenuOpen && (
                            <div className="absolute left-0 top-full z-50 mt-2.5 w-62 border border-on-surface/20 bg-surface-container-lowest py-2 drop-shadow-2xl">
                                <button
                                    type="button"
                                    onClick={closeAfter(openImport)}
                                    className="flex w-full items-center gap-3 px-4 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container hover:text-primary"
                                >
                                    <Upload className="size-4" />
                                    Import STL…
                                    <span className="ml-auto font-mono text-tiny text-tertiary">⌘I</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={closeAfter(() => onExport?.())}
                                    className="flex w-full items-center gap-3 px-4 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container hover:text-primary"
                                >
                                    <Download className="size-4" />
                                    Export STL…
                                    <span className="ml-auto font-mono text-tiny text-tertiary">⌘E</span>
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => onNavigate("draw")}
                        className={cn(
                            "pb-1 text-sm transition-colors",
                            view === "draw"
                                ? "border-b-2 border-primary font-bold text-primary"
                                : "font-medium text-on-surface-variant hover:text-primary"
                        )}
                    >
                        Draw
                    </button>
                    <button
                        type="button"
                        onClick={() => onNavigate("editor")}
                        className={cn(
                            "pb-1 text-sm transition-colors",
                            view === "editor"
                                ? "border-b-2 border-primary font-bold text-primary"
                                : "font-medium text-on-surface-variant hover:text-primary"
                        )}
                    >
                        3D View
                    </button>
                </nav>
            </div>
            <button
                type="button"
                onClick={() => onNavigate("settings")}
                aria-label="Settings"
                className={cn(
                    "transition-colors",
                    view === "settings" ? "text-primary" : "text-on-surface hover:text-primary"
                )}
            >
                <Settings className="size-5" />
            </button>
        </header>
    )
}
