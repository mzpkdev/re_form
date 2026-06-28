import { Bot, DraftingCompass, Shuffle, Wrench } from "lucide-react"
import { cn } from "../design/cn"

type Panel = "ai" | "tools" | "shuffle" | "draw"

const NavItem = ({
    icon: Icon,
    label,
    active,
    onClick
}: {
    icon: typeof Bot
    label: string
    active: boolean
    onClick: () => void
}) => (
    <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
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
)

export const Sidebar = ({
    activePanel,
    onSelect,
    onExport
}: {
    activePanel: Panel | null
    onSelect: (panel: Panel) => void
    onExport?: () => void
}) => (
    <aside className="flex h-full w-sidebar flex-col border-r border-on-surface/10 bg-surface">
        <div className="border-b border-on-surface/10 bg-primary p-6">
            <div className="mb-1 font-mono text-label-caps uppercase tracking-widest text-on-primary/70">EDITOR</div>
            <h2 className="font-mono text-xl font-semibold text-on-primary">PROJECT_NAME</h2>
        </div>
        <nav className="flex flex-1 flex-col gap-2 py-4">
            <NavItem icon={Wrench} label="Tools" active={activePanel === "tools"} onClick={() => onSelect("tools")} />
            <NavItem
                icon={DraftingCompass}
                label="Drawing"
                active={activePanel === "draw"}
                onClick={() => onSelect("draw")}
            />
            <NavItem
                icon={Shuffle}
                label="Shuffle"
                active={activePanel === "shuffle"}
                onClick={() => onSelect("shuffle")}
            />
            <NavItem icon={Bot} label="AI Assistant" active={activePanel === "ai"} onClick={() => onSelect("ai")} />
        </nav>
        <div className="border-t border-on-surface/10 p-6">
            <button
                type="button"
                onClick={() => onExport?.()}
                className="w-full border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container"
            >
                EXPORT_STL
            </button>
        </div>
    </aside>
)
