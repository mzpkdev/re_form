import type { ShapeGroup } from "./types"

/**
 * Pure helpers backing the segment panel's hierarchy + multi-select (M2.4). Kept
 * React-free and side-effect-free so the grouping/selection logic is unit-tested
 * directly, separate from the rendering and the store wiring.
 */

/**
 * One top-level entry in the panel list: either a synthesized BODY header with
 * its child leaf groups nested beneath, or a LEAF group rendered flat at the top
 * level (the M1 regions-off bodies, or a parent-less `unknown`).
 *
 * Bodies are not real `ShapeGroup`s in M2 — the orchestrator carries the
 * body→patch relationship on each leaf's `parentId` (an opaque body uuid). A body
 * entry's `id` is that shared `parentId`; its `label` is "Body N" by
 * first-appearance order; `childIds` are its leaves' ids (handy for whole-body
 * select/export without re-walking).
 */
export type PanelEntry =
    | { kind: "body"; id: string; label: string; children: ShapeGroup[]; childIds: string[] }
    | { kind: "leaf"; group: ShapeGroup }

/**
 * Fold a flat `ShapeGroup[]` into the panel's hierarchy, preserving render order.
 *
 * Walks the groups once. A group with a null/absent `parentId` becomes a
 * top-level `leaf` entry at its own position. A group with a non-null `parentId`
 * is filed under a `body` entry keyed by that `parentId`; the body entry is
 * created the first time one of its children appears (so body headers slot in at
 * the position of their first child) and labelled "Body N" by that
 * first-appearance order. Children keep their relative order within the body.
 *
 * The result is a flat, ordered list mixing body headers and top-level leaves —
 * exactly the order the panel renders them in.
 */
export const groupByParent = (groups: readonly ShapeGroup[]): PanelEntry[] => {
    const entries: PanelEntry[] = []
    const bodyById = new Map<string, Extract<PanelEntry, { kind: "body" }>>()

    for (const group of groups) {
        const parentId = group.parentId ?? null
        if (parentId === null) {
            entries.push({ kind: "leaf", group })
            continue
        }

        let body = bodyById.get(parentId)
        if (!body) {
            body = {
                kind: "body",
                id: parentId,
                label: `Body ${bodyById.size + 1}`,
                children: [],
                childIds: []
            }
            bodyById.set(parentId, body)
            entries.push(body)
        }
        body.children.push(group)
        body.childIds.push(group.id)
    }

    return entries
}

/**
 * Toggle `id` in a selection: drop it when already selected, otherwise add it to
 * the end. Returns a FRESH array (the selection store keys on replacement), and
 * never mutates `current`. The primitive behind shift/ctrl-click multi-select in
 * the panel and shift-add picking in the viewport.
 */
export const toggleSelection = (current: readonly string[], id: string): string[] =>
    current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id]
