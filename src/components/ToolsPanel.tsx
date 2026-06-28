import { Link2, Wrench, X } from "lucide-react"
import { type ReactNode, useState } from "react"
import { cn } from "../design/cn"
import type { Transform, Vec3 } from "../lib/model"

type Axis = 0 | 1 | 2

const NumField = ({ axis, value, onCommit }: { axis: string; value: number; onCommit: (next: number) => void }) => (
    <div className="flex flex-1 items-center gap-1">
        <span className="font-mono text-tiny text-tertiary">{axis}</span>
        <input
            type="number"
            value={value}
            onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value)
                // Ignore empty / mid-edit non-numbers so typing never crashes the
                // manifold pipeline; the field keeps the last valid commit.
                if (!Number.isNaN(parsed)) {
                    onCommit(parsed)
                }
            }}
            className="w-full rounded-none border-0 border-b-2 border-on-surface bg-surface-container-low px-2 py-1.5 text-right font-mono text-mono-data text-on-surface focus:border-primary focus:outline-none"
        />
    </div>
)

const TransformRow = ({
    label,
    values,
    onAxis,
    action
}: {
    label: string
    values: Vec3
    onAxis: (axis: Axis, next: number) => void
    action?: ReactNode
}) => (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
            <span className="font-sans text-body-sm text-on-surface">{label}</span>
            {action}
        </div>
        <div className="flex gap-2">
            <NumField axis="X" value={values[0]} onCommit={(next) => onAxis(0, next)} />
            <NumField axis="Y" value={values[1]} onCommit={(next) => onAxis(1, next)} />
            <NumField axis="Z" value={values[2]} onCommit={(next) => onAxis(2, next)} />
        </div>
    </div>
)

export const ToolsPanel = ({
    open,
    onClose,
    transform,
    onChange
}: {
    open: boolean
    onClose: () => void
    transform: Transform
    onChange: (next: Transform) => void
}) => {
    const [uniform, setUniform] = useState(false)

    const setAxis = (key: keyof Transform, axis: Axis, next: number) => {
        const updated = [...transform[key]] as Vec3
        updated[axis] = next
        onChange({ ...transform, [key]: updated })
    }

    const setScaleAxis = (axis: Axis, next: number) => {
        // Uniform scale links all three axes off the edited one.
        if (uniform) {
            onChange({ ...transform, scale: [next, next, next] })
            return
        }
        setAxis("scale", axis, next)
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
                        <Wrench className="size-5 text-primary" />
                        <h3 className="font-mono text-title-md text-on-surface">TOOLS</h3>
                    </div>
                    <button type="button" onClick={onClose} className="text-tertiary hover:text-on-surface">
                        <X className="size-5" />
                    </button>
                </div>

                <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
                    <div className="flex flex-col gap-4">
                        <div className="font-mono text-label-caps uppercase tracking-widest text-tertiary">
                            Transform
                        </div>
                        <TransformRow
                            label="Position"
                            values={transform.position}
                            onAxis={(axis, next) => setAxis("position", axis, next)}
                        />
                        <TransformRow
                            label="Rotation"
                            values={transform.rotation}
                            onAxis={(axis, next) => setAxis("rotation", axis, next)}
                        />
                        <TransformRow
                            label="Scale"
                            values={transform.scale}
                            onAxis={setScaleAxis}
                            action={
                                <button
                                    type="button"
                                    title="Uniform scale"
                                    aria-pressed={uniform}
                                    onClick={() => setUniform((on) => !on)}
                                    className={uniform ? "text-primary" : "text-tertiary hover:text-on-surface"}
                                >
                                    <Link2 className="size-4" />
                                </button>
                            }
                        />
                    </div>
                </div>
            </div>
        </aside>
    )
}
