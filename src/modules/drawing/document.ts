import type { Drawing, Entity } from "./types"

/**
 * Pure, immutable operations over a Drawing document. Every function returns a
 * NEW Drawing and never mutates its input — the editor's undo/redo and React
 * state both rely on that. React-free by design.
 */

/** The default grid spacing (mm) a fresh document starts with. */
export const DEFAULT_GRID_SIZE = 10

/** An empty document on the default 10 mm grid. */
export const createDrawing = (): Drawing => ({
    version: 1,
    units: "mm",
    gridSize: DEFAULT_GRID_SIZE,
    entities: []
})

/** Append `entity`, returning a new document. */
export const addEntity = (doc: Drawing, entity: Entity): Drawing => ({
    ...doc,
    entities: [...doc.entities, entity]
})

/**
 * Shallow-merge `patch` into the entity with id `id`, returning a new document.
 * The discriminant `type` is preserved (a patch may carry a `type`, but the
 * matching entity's own type always wins, so the union stays sound). When no
 * entity matches, the original document is returned unchanged.
 */
export const updateEntity = (doc: Drawing, id: string, patch: Partial<Entity>): Drawing => {
    let changed = false
    const entities = doc.entities.map((entity) => {
        if (entity.id !== id) return entity
        changed = true
        return { ...entity, ...patch, id: entity.id, type: entity.type } as Entity
    })
    if (!changed) return doc
    return { ...doc, entities }
}

/** Drop the entity with id `id`, returning a new document. */
export const removeEntity = (doc: Drawing, id: string): Drawing => ({
    ...doc,
    entities: doc.entities.filter((entity) => entity.id !== id)
})

/** The entity with id `id`, or `undefined` when none matches. */
export const getEntity = (doc: Drawing, id: string): Entity | undefined =>
    doc.entities.find((entity) => entity.id === id)
