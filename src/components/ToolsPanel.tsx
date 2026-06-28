import { Link2, Wrench, X } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../design/cn"

const NumField = ({ axis, value }: { axis: string; value: string }) => (
    <div className="flex flex-1 items-center gap-1">
        <span className="font-mono text-tiny text-tertiary">{axis}</span>
        <input
            defaultValue={value}
            className="w-full rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1.5 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
        />
    </div>
)

const TransformRow = ({
    label,
    values,
    action
}: {
    label: string
    values: [string, string, string]
    action?: ReactNode
}) => (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
            <span className="font-sans text-body-sm text-on-surface">{label}</span>
            {action}
        </div>
        <div className="flex gap-2">
            <NumField axis="X" value={values[0]} />
            <NumField axis="Y" value={values[1]} />
            <NumField axis="Z" value={values[2]} />
        </div>
    </div>
)

export const ToolsPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => (
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
                    <Wrench className="size-5 text-primary" />
                    <h3 className="font-mono text-title-md text-on-surface">TOOLS</h3>
                </div>
                <button type="button" onClick={onClose} className="text-tertiary hover:text-on-surface">
                    <X className="size-5" />
                </button>
            </div>

            <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
                <div className="flex flex-col gap-4">
                    <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">Transform</div>
                    <TransformRow label="Position" values={["120.5", "44.2", "-10.0"]} />
                    <TransformRow label="Rotation" values={["0", "0", "0"]} />
                    <TransformRow
                        label="Scale"
                        values={["1.15", "1.00", "1.00"]}
                        action={
                            <button type="button" title="Uniform scale" className="text-primary">
                                <Link2 className="size-4" />
                            </button>
                        }
                    />
                </div>
            </div>
        </div>
    </aside>
)
