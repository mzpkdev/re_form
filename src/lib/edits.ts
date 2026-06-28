import type { Manifold, ManifoldToplevel } from "manifold-3d"

/**
 * The CSG edit vocabulary the AI assistant invokes via tool-calling.
 *
 * This module is React-free and self-contained: the tool-definition shape is
 * declared locally rather than imported from the openrouter client so the two
 * can be built independently. Every operation works in MILLIMETRES.
 */

/** OpenAI-compatible tool definition (function calling). Declared locally on purpose. */
type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } }

/** Round shapes are tessellated at this segment count — smooth without exploding triangle count. */
const CIRCULAR_SEGMENTS = 48

/** A positioned-primitive parameter block, shared by add/cut/intersect and (without x/y/z) create. */
const PRIMITIVE_PROPERTIES = {
    shape: {
        type: "string",
        enum: ["cube", "sphere", "cylinder"],
        description: "Primitive kind to build."
    },
    size_x: { type: "number", description: "Cube width along X in millimetres (cube only)." },
    size_y: { type: "number", description: "Cube depth along Y in millimetres (cube only)." },
    size_z: { type: "number", description: "Cube height along Z in millimetres (cube only)." },
    radius: { type: "number", description: "Radius in millimetres (sphere and cylinder)." },
    height: { type: "number", description: "Cylinder height along Z in millimetres (cylinder only)." },
    x: { type: "number", description: "X position of the primitive's centre in millimetres (default 0)." },
    y: { type: "number", description: "Y position of the primitive's centre in millimetres (default 0)." },
    z: { type: "number", description: "Z position of the primitive's centre in millimetres (default 0)." }
}

export const EDIT_TOOLS: ToolDef[] = [
    {
        type: "function",
        function: {
            name: "create_primitive",
            description:
                "Create a fresh primitive solid centred at the origin, replacing any current solid. Use this to start a new model. All measurements are in millimetres.",
            parameters: {
                type: "object",
                properties: {
                    shape: {
                        type: "string",
                        enum: ["cube", "sphere", "cylinder"],
                        description: "Primitive kind to build."
                    },
                    size_x: { type: "number", description: "Cube width along X in millimetres (cube only)." },
                    size_y: { type: "number", description: "Cube depth along Y in millimetres (cube only)." },
                    size_z: { type: "number", description: "Cube height along Z in millimetres (cube only)." },
                    radius: { type: "number", description: "Radius in millimetres (sphere and cylinder)." },
                    height: { type: "number", description: "Cylinder height along Z in millimetres (cylinder only)." }
                },
                required: ["shape"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "drill_hole",
            description:
                "Drill a cylindrical hole through the current solid by subtracting a cylinder. The cylinder's length runs along the chosen axis and it is centred at (x, y, z). All measurements are in millimetres.",
            parameters: {
                type: "object",
                properties: {
                    radius: { type: "number", description: "Hole radius in millimetres." },
                    depth: { type: "number", description: "Hole length along the chosen axis in millimetres." },
                    axis: {
                        type: "string",
                        enum: ["x", "y", "z"],
                        description: "Axis the hole runs along."
                    },
                    x: { type: "number", description: "X position of the hole's centre in millimetres (default 0)." },
                    y: { type: "number", description: "Y position of the hole's centre in millimetres (default 0)." },
                    z: { type: "number", description: "Z position of the hole's centre in millimetres (default 0)." }
                },
                required: ["radius", "depth", "axis"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "add_primitive",
            description:
                "Add (union) a positioned primitive onto the current solid. All measurements are in millimetres.",
            parameters: {
                type: "object",
                properties: PRIMITIVE_PROPERTIES,
                required: ["shape"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "cut_primitive",
            description:
                "Cut (subtract) a positioned primitive out of the current solid. All measurements are in millimetres.",
            parameters: {
                type: "object",
                properties: PRIMITIVE_PROPERTIES,
                required: ["shape"],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "intersect_primitive",
            description:
                "Intersect the current solid with a positioned primitive, keeping only the overlapping volume. All measurements are in millimetres.",
            parameters: {
                type: "object",
                properties: PRIMITIVE_PROPERTIES,
                required: ["shape"],
                additionalProperties: false
            }
        }
    }
]

/** A finite number, or undefined when absent. Anything else (NaN, Infinity, non-number) throws. */
const optionalFinite = (value: unknown, label: string): number | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${label} must be a finite number`)
    }
    return value
}

/** A finite number defaulting to 0 — used for optional positions. */
const position = (value: unknown, label: string): number => optionalFinite(value, label) ?? 0

/** A strictly-positive finite dimension. Throws on missing, non-positive, or non-finite input. */
const dimension = (value: unknown, label: string): number => {
    const n = optionalFinite(value, label)
    if (n === undefined) {
        throw new Error(`${label} is required and must be greater than 0`)
    }
    if (n <= 0) {
        throw new Error(`${label} must be greater than 0`)
    }
    return n
}

/** Default cube edge / sphere / cylinder dimensions when the caller omits them (millimetres). */
const DEFAULT_SIZE = 10

/**
 * Build a fresh primitive centred at the origin from a loosely-typed arg bag.
 * Returns a single new Manifold and deletes nothing of the caller's — the
 * returned handle is the caller's to delete.
 */
const buildPrimitive = (wasm: ManifoldToplevel, args: Record<string, unknown>): Manifold => {
    const shape = args.shape
    if (shape === "cube") {
        const sx = args.size_x === undefined ? DEFAULT_SIZE : dimension(args.size_x, "size_x")
        const sy = args.size_y === undefined ? DEFAULT_SIZE : dimension(args.size_y, "size_y")
        const sz = args.size_z === undefined ? DEFAULT_SIZE : dimension(args.size_z, "size_z")
        return wasm.Manifold.cube([sx, sy, sz], true)
    }
    if (shape === "sphere") {
        const radius = args.radius === undefined ? DEFAULT_SIZE : dimension(args.radius, "radius")
        return wasm.Manifold.sphere(radius, CIRCULAR_SEGMENTS)
    }
    if (shape === "cylinder") {
        const radius = args.radius === undefined ? DEFAULT_SIZE : dimension(args.radius, "radius")
        const height = args.height === undefined ? DEFAULT_SIZE : dimension(args.height, "height")
        return wasm.Manifold.cylinder(height, radius, radius, CIRCULAR_SEGMENTS, true)
    }
    throw new Error(`unknown shape "${String(shape)}" — expected cube, sphere, or cylinder`)
}

/** Translate a manifold to (x, y, z), deleting the input and returning the moved handle. */
const moveTo = (solid: Manifold, x: number, y: number, z: number): Manifold => {
    const moved = solid.translate([x, y, z])
    solid.delete()
    return moved
}

/** Validity gate mirroring the rest of the codebase: empty / errored / non-positive volume is bad. */
const isInvalid = (m: Manifold): boolean => m.isEmpty() || m.status() !== "NoError" || m.volume() <= 0

/**
 * Apply a single named CSG edit and return a NEW Manifold.
 *
 * Ownership: `source` belongs to the caller and is never deleted here. Every
 * intermediate this function allocates (primitives, rotated/translated
 * temporaries) is deleted before returning. `create_primitive` ignores
 * `source`; every other op requires it. Invalid args throw with a clear
 * message; a degenerate result is deleted and reported as invalid.
 */
export const applyEdit = (wasm: ManifoldToplevel, source: Manifold | null, name: string, args: unknown): Manifold => {
    if (typeof args !== "object" || args === null) {
        throw new Error("edit arguments must be an object")
    }
    const a = args as Record<string, unknown>

    let result: Manifold
    if (name === "create_primitive") {
        result = buildPrimitive(wasm, a)
    } else if (name === "drill_hole") {
        if (!source) {
            throw new Error("no editable solid — create a primitive or import an STL first")
        }
        const radius = dimension(a.radius, "radius")
        const depth = dimension(a.depth, "depth")
        const axis = a.axis
        const x = position(a.x, "x")
        const y = position(a.y, "y")
        const z = position(a.z, "z")
        // Cylinder length runs along +Z by default; rotate so it runs along the chosen axis.
        const bore = wasm.Manifold.cylinder(depth, radius, radius, CIRCULAR_SEGMENTS, true)
        let oriented: Manifold
        if (axis === "x") {
            oriented = bore.rotate([0, 90, 0])
        } else if (axis === "y") {
            oriented = bore.rotate([90, 0, 0])
        } else if (axis === "z") {
            oriented = bore.rotate([0, 0, 0])
        } else {
            bore.delete()
            throw new Error(`unknown axis "${String(axis)}" — expected x, y, or z`)
        }
        bore.delete()
        const placed = moveTo(oriented, x, y, z)
        result = source.subtract(placed)
        placed.delete()
    } else if (name === "add_primitive" || name === "cut_primitive" || name === "intersect_primitive") {
        if (!source) {
            throw new Error("no editable solid — create a primitive or import an STL first")
        }
        const primitive = buildPrimitive(wasm, a)
        const placed = moveTo(primitive, position(a.x, "x"), position(a.y, "y"), position(a.z, "z"))
        if (name === "add_primitive") {
            result = source.add(placed)
        } else if (name === "cut_primitive") {
            result = source.subtract(placed)
        } else {
            result = source.intersect(placed)
        }
        placed.delete()
    } else {
        throw new Error(`unknown edit "${name}"`)
    }

    if (isInvalid(result)) {
        result.delete()
        throw new Error("edit produced an empty or invalid solid")
    }
    return result
}
