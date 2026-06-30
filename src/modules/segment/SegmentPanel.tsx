import { parseColor } from "@ark-ui/react/color-picker"
import { Boxes, Download, Loader2, Scissors, Trash2, X } from "lucide-react"
import { Virtuoso } from "react-virtuoso"
import type * as THREE from "three"
import { ColorPicker, cn } from "../../design"
import { downloadStl, exportGroups } from "./groupExport"
import { groupByParent, type PanelEntry, toggleSelection } from "./groupHierarchy"
import { setGroups, useGroups } from "./groupsStore"
import { setSelection, useSelection } from "./selectionStore"
import type { ShapeGroup } from "./types"
import { useSegmentation } from "./useSegmentation"

/** A group's `[r, g, b]` (0–1 floats) as a CSS `rgb(...)` string for the swatch. */
const rgbCss = ([r, g, b]: [number, number, number]): string =>
    `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`

/** Read an Ark color picker `Color` back into the `[r, g, b]` 0–1 triple the model stores. */
const colorToTriple = (color: ReturnType<typeof parseColor>): [number, number, number] => [
    color.getChannelValue("red") / 255,
    color.getChannelValue("green") / 255,
    color.getChannelValue("blue") / 255
]

/**
 * Whether a pointer/keyboard event requests an ADDITIVE (toggle) selection —
 * shift, ctrl, or meta (⌘) held — versus a plain click that replaces. Shared by
 * the body-header and leaf-row select handlers so the modifier contract is
 * identical everywhere.
 */
const isAdditive = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean =>
    event.shiftKey || event.metaKey || event.ctrlKey

/**
 * Replace one group's `color`, returning a FRESH array of FRESH group objects.
 * The store's delete-on-replace keys on object identity, so the edited group must
 * be a new object (spread copy); carried-over groups keep their identity.
 */
export const recolorGroup = (groups: ShapeGroup[], id: string, color: [number, number, number]): ShapeGroup[] =>
    groups.map((group) => (group.id === id ? { ...group, color } : group))

/** Replace one group's `label`, same fresh-object discipline as {@link recolorGroup}. */
export const renameGroup = (groups: ShapeGroup[], id: string, label: string): ShapeGroup[] =>
    groups.map((group) => (group.id === id ? { ...group, label } : group))

const Row = ({
    group,
    selected,
    nested,
    geometry,
    onSelect,
    onRecolor,
    onRename,
    onDelete
}: {
    group: ShapeGroup
    selected: boolean
    nested?: boolean
    geometry: THREE.BufferGeometry
    onSelect: (id: string, additive: boolean) => void
    onRecolor: (id: string, color: [number, number, number]) => void
    onRename: (id: string, label: string) => void
    onDelete: (id: string) => void
}) => {
    return (
        // A div (not a button) so the nested color-picker / export / delete buttons
        // are valid HTML; keyboard-activatable via role + Enter/Space.
        // biome-ignore lint/a11y/useSemanticElements: the row hosts nested interactive controls (color picker, export, delete), so it can't itself be a <button>.
        <div
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={(event) => onSelect(group.id, isAdditive(event))}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelect(group.id, isAdditive(event))
                }
            }}
            className={cn(
                "flex w-full cursor-pointer items-center gap-3 border-b border-on-surface/10 px-2 py-3 text-left transition-colors",
                nested && "pl-6",
                selected ? "bg-surface-container" : "hover:bg-surface-container-low"
            )}
        >
            {/* Swatch — recolor on commit (drag-end), not on every tick, to spare the store churn. */}
            <ColorPicker.Root
                defaultValue={parseColor(rgbCss(group.color))}
                onValueChangeEnd={(details) => onRecolor(group.id, colorToTriple(details.value))}
                // Keep picker interactions from bubbling to the row's select handler.
                onClick={(event) => event.stopPropagation()}
            >
                <ColorPicker.Control>
                    <ColorPicker.Trigger aria-label="Group color">
                        <ColorPicker.ValueSwatch className="size-full rounded-control" />
                    </ColorPicker.Trigger>
                </ColorPicker.Control>
                <ColorPicker.Positioner>
                    <ColorPicker.Content>
                        <ColorPicker.Area>
                            <ColorPicker.AreaBackground />
                            <ColorPicker.AreaThumb />
                        </ColorPicker.Area>
                        <ColorPicker.ChannelSlider channel="hue">
                            <ColorPicker.ChannelSliderThumb />
                        </ColorPicker.ChannelSlider>
                    </ColorPicker.Content>
                </ColorPicker.Positioner>
                <ColorPicker.HiddenInput />
            </ColorPicker.Root>

            {/* Editable label. Clicking into it must not re-fire the row's select handler. */}
            <input
                value={group.label}
                onChange={(event) => onRename(group.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
                className="min-w-0 flex-1 rounded-none border-0 border-b border-transparent bg-transparent px-1 py-0.5 font-sans text-body-sm text-on-surface focus:border-primary focus:outline-none"
            />

            <button
                type="button"
                title="Export this group as STL"
                onClick={(event) => {
                    event.stopPropagation()
                    downloadStl(exportGroups(geometry, [group]), `${group.label}.stl`)
                }}
                className="shrink-0 text-tertiary transition-colors hover:text-on-surface"
            >
                <Download className="size-4" />
            </button>
            <button
                type="button"
                title="Delete group"
                onClick={(event) => {
                    event.stopPropagation()
                    onDelete(group.id)
                }}
                className="shrink-0 text-tertiary transition-colors hover:text-error"
            >
                <Trash2 className="size-4" />
            </button>
        </div>
    )
}

/**
 * A synthesized body header (M2.4). Bodies are not real `ShapeGroup`s — they're
 * folded from the leaves' shared `parentId` ({@link groupByParent}) — so the
 * header carries no swatch/rename: clicking it whole-body-selects its children
 * (additive when a modifier is held), and its Export bakes all child leaves into
 * one STL. `allSelected` lights the header when every child is selected.
 */
const BodyHeader = ({
    label,
    childIds,
    childGroups,
    allSelected,
    onSelect,
    onExport
}: {
    label: string
    childIds: string[]
    childGroups: ShapeGroup[]
    allSelected: boolean
    onSelect: (ids: string[], additive: boolean) => void
    onExport: (groups: ShapeGroup[], name: string) => void
}) => {
    return (
        // biome-ignore lint/a11y/useSemanticElements: the header hosts a nested export button, so it can't itself be a <button>.
        <div
            role="button"
            tabIndex={0}
            aria-pressed={allSelected}
            onClick={(event) => onSelect(childIds, isAdditive(event))}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelect(childIds, isAdditive(event))
                }
            }}
            className={cn(
                "flex w-full cursor-pointer items-center gap-2 border-b border-on-surface/10 px-2 py-2 text-left transition-colors",
                allSelected ? "bg-surface-container" : "hover:bg-surface-container-low"
            )}
        >
            <Boxes className="size-4 shrink-0 text-tertiary" />
            <span className="min-w-0 flex-1 truncate font-mono text-label-caps text-on-surface">{label}</span>
            <button
                type="button"
                title="Export this body as STL"
                onClick={(event) => {
                    event.stopPropagation()
                    onExport(childGroups, `${label}.stl`)
                }}
                className="shrink-0 text-tertiary transition-colors hover:text-on-surface"
            >
                <Download className="size-4" />
            </button>
        </div>
    )
}

export const SegmentPanel = ({
    open,
    onClose,
    geometry
}: {
    open: boolean
    onClose: () => void
    geometry: THREE.BufferGeometry | null
}) => {
    const { run, isPending, error } = useSegmentation(geometry)
    const groups = useGroups()
    const selection = useSelection()
    const selected = new Set(selection)
    const hasGroups = groups.length > 0
    const entries = groupByParent(groups)

    // Edits always produce FRESH group objects (the store's delete-on-replace keys
    // on identity); reading `groups`/`selection` from this render is correct because
    // every mutation re-renders the panel before the next interaction.
    const handleRecolor = (id: string, color: [number, number, number]) => setGroups(recolorGroup(groups, id, color))
    const handleRename = (id: string, label: string) => setGroups(renameGroup(groups, id, label))
    const handleDelete = (id: string) => {
        setGroups(groups.filter((group) => group.id !== id))
        setSelection(selection.filter((selectedId) => selectedId !== id))
    }

    // Plain click replaces the selection; shift/ctrl/meta toggles the row in/out.
    const handleSelectRow = (id: string, additive: boolean) =>
        setSelection(additive ? toggleSelection(selection, id) : [id])

    // A body header selects ALL its child leaves at once; additive merges them
    // into the current selection (deduped) rather than replacing.
    const handleSelectBody = (ids: string[], additive: boolean) =>
        setSelection(additive ? [...new Set([...selection, ...ids])] : ids)

    // Bake a set of groups into one STL and download it. `geometry` is null only
    // before import, when no export control is rendered.
    const handleExport = (exportGroupsArg: ShapeGroup[], name: string) => {
        if (geometry) {
            downloadStl(exportGroups(geometry, exportGroupsArg), name)
        }
    }

    const selectedGroups = groups.filter((group) => selected.has(group.id))

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
                        <Scissors className="size-5 text-primary" />
                        <h3 className="font-mono text-title-md text-on-surface">SEGMENT</h3>
                    </div>
                    <button type="button" onClick={onClose} className="text-tertiary hover:text-on-surface">
                        <X className="size-5" />
                    </button>
                </div>

                {geometry ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
                        <p className="font-sans text-body-sm text-tertiary">
                            Split the imported model into selectable groups. Click a group to isolate it; shift- or
                            ⌘-click to multi-select. Rename, recolor, or export any group on its own.
                        </p>

                        <button
                            type="button"
                            onClick={run}
                            disabled={isPending}
                            className="flex w-full items-center justify-center gap-2 border border-transparent bg-primary py-3 font-mono text-label-caps text-on-primary transition-colors chamfer hover:border-on-surface hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                            {isPending ? "Segmenting…" : hasGroups ? "Re-segment" : "Segment"}
                        </button>

                        {selectedGroups.length > 0 ? (
                            <button
                                type="button"
                                title="Export the selected groups as one STL"
                                onClick={() => handleExport(selectedGroups, "selection.stl")}
                                className="flex w-full items-center justify-center gap-2 border border-on-surface/20 py-2 font-mono text-label-caps text-on-surface transition-colors hover:border-on-surface hover:bg-surface-container"
                            >
                                <Download className="size-4" />
                                Export selected ({selectedGroups.length})
                            </button>
                        ) : null}

                        {error ? <div className="font-mono text-tiny text-error">{error.message}</div> : null}

                        {hasGroups ? (
                            <div className="min-h-0 flex-1">
                                <Virtuoso
                                    data={entries}
                                    className="h-full"
                                    itemContent={(_index, entry: PanelEntry) =>
                                        entry.kind === "body" ? (
                                            <div>
                                                <BodyHeader
                                                    label={entry.label}
                                                    childIds={entry.childIds}
                                                    childGroups={entry.children}
                                                    allSelected={
                                                        entry.children.length > 0 &&
                                                        entry.children.every((child) => selected.has(child.id))
                                                    }
                                                    onSelect={handleSelectBody}
                                                    onExport={handleExport}
                                                />
                                                {entry.children.map((child) => (
                                                    <Row
                                                        key={child.id}
                                                        group={child}
                                                        selected={selected.has(child.id)}
                                                        nested
                                                        geometry={geometry}
                                                        onSelect={handleSelectRow}
                                                        onRecolor={handleRecolor}
                                                        onRename={handleRename}
                                                        onDelete={handleDelete}
                                                    />
                                                ))}
                                            </div>
                                        ) : (
                                            <Row
                                                group={entry.group}
                                                selected={selected.has(entry.group.id)}
                                                geometry={geometry}
                                                onSelect={handleSelectRow}
                                                onRecolor={handleRecolor}
                                                onRename={handleRename}
                                                onDelete={handleDelete}
                                            />
                                        )
                                    }
                                />
                            </div>
                        ) : (
                            <p className="font-sans text-body-sm text-tertiary">
                                {isPending ? "Working…" : "Segment to split the model into groups."}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
                        <p className="font-sans text-body-sm text-tertiary">Import an STL (⌘I) to segment it.</p>
                    </div>
                )}
            </div>
        </aside>
    )
}
