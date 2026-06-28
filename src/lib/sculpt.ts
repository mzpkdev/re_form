import type { Manifold, ManifoldToplevel } from "manifold-3d"
import type { Vec3 } from "./model"
import {
    box,
    capsule,
    cylinder,
    ellipsoid,
    rotated,
    roundBox,
    type Sdf,
    scaled,
    smoothUnion,
    sphere,
    translated,
    union
} from "./sdf"

/**
 * A declarative sculpting vocabulary: a scene is a bag of primitive {@link SculptPart}s
 * blended into one organic solid. {@link compileScene} lowers the scene to a single
 * conventional (negative-inside) {@link Sdf} plus a tight bounding box; {@link buildSculpt}
 * meshes that field into a watertight {@link Manifold} via manifold's `levelSet`.
 *
 * This module is the bridge between the React-free SDF math in `sdf.ts` and manifold's
 * isosurfacer, and it owns the sign flip that `levelSet` requires (it wants positive-inside).
 */

/** Structural mirror of openrouter's `ToolDef` — kept local to avoid a value/type coupling. */
type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } }

export type SculptPart = {
    shape: "sphere" | "ellipsoid" | "box" | "roundBox" | "capsule" | "cylinder"
    radius?: number // sphere | capsule | cylinder
    radii?: Vec3 // ellipsoid
    halfExtents?: Vec3 // box | roundBox
    rounding?: number // roundBox
    a?: Vec3 // capsule endpoint (local frame)
    b?: Vec3 // capsule endpoint (local frame)
    height?: number // cylinder
    position?: Vec3 // translate (mm)
    rotation?: Vec3 // euler degrees x->y->z
    scale?: number // uniform
}

export type SculptScene = { parts: SculptPart[]; smoothness?: number }

/** A part's local-frame axis-aligned half-extents, before its own transform is applied. */
type LocalAabb = { min: Vec3; max: Vec3 }

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const assertFiniteVec3 = (value: unknown, label: string): Vec3 => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
        throw new Error(`${label} must be three finite numbers`)
    }
    return value as Vec3
}

const assertPositive = (value: unknown, label: string): number => {
    if (!isFiniteNumber(value) || value <= 0) {
        throw new Error(`${label} must be a finite number greater than 0`)
    }
    return value
}

/** Build a single part's primitive SDF (in its own local frame, centered at origin). */
const partPrimitive = (part: SculptPart): Sdf => {
    switch (part.shape) {
        case "sphere":
            return sphere(assertPositive(part.radius, "sphere radius"))
        case "ellipsoid": {
            const radii = assertFiniteVec3(part.radii, "ellipsoid radii")
            if (radii.some((r) => r <= 0)) throw new Error("ellipsoid radii must all be greater than 0")
            return ellipsoid(radii)
        }
        case "box":
            return box(assertHalfExtents(part.halfExtents, "box halfExtents"))
        case "roundBox": {
            const halfExtents = assertHalfExtents(part.halfExtents, "roundBox halfExtents")
            const rounding = assertPositive(part.rounding, "roundBox rounding")
            return roundBox(halfExtents, rounding)
        }
        case "capsule": {
            const a = assertFiniteVec3(part.a, "capsule a")
            const b = assertFiniteVec3(part.b, "capsule b")
            return capsule(a, b, assertPositive(part.radius, "capsule radius"))
        }
        case "cylinder":
            return cylinder(
                assertPositive(part.height, "cylinder height"),
                assertPositive(part.radius, "cylinder radius")
            )
        default:
            throw new Error(`unknown shape: ${String((part as { shape?: unknown }).shape)}`)
    }
}

const assertHalfExtents = (value: unknown, label: string): Vec3 => {
    const halfExtents = assertFiniteVec3(value, label)
    if (halfExtents.some((h) => h <= 0)) throw new Error(`${label} must all be greater than 0`)
    return halfExtents
}

/** The part's local-frame AABB (origin-centered) from its raw params, pre-transform. */
const localAabb = (part: SculptPart): LocalAabb => {
    switch (part.shape) {
        case "sphere": {
            const r = part.radius as number
            return { min: [-r, -r, -r], max: [r, r, r] }
        }
        case "ellipsoid": {
            const [rx, ry, rz] = part.radii as Vec3
            return { min: [-rx, -ry, -rz], max: [rx, ry, rz] }
        }
        case "box":
        case "roundBox": {
            const [hx, hy, hz] = part.halfExtents as Vec3
            return { min: [-hx, -hy, -hz], max: [hx, hy, hz] }
        }
        case "capsule": {
            const a = part.a as Vec3
            const b = part.b as Vec3
            const r = part.radius as number
            return {
                min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
                max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r]
            }
        }
        case "cylinder": {
            const r = part.radius as number
            const h = (part.height as number) / 2
            return { min: [-r, -h, -r], max: [r, h, r] }
        }
        default:
            throw new Error(`unknown shape: ${String((part as { shape?: unknown }).shape)}`)
    }
}

/**
 * Conservative world-space AABB of a part: scale the local AABB, treat it as a
 * sphere of that radius (so any rotation is covered without recomputing corners),
 * then offset by the part's position. Rotation-invariant by construction.
 */
const worldAabb = (part: SculptPart): LocalAabb => {
    const local = localAabb(part)
    const scale = part.scale ?? 1
    const position = part.position ?? [0, 0, 0]
    // Largest extent from origin in any axis, scaled — a bound that survives rotation.
    const reach =
        scale *
        Math.max(
            Math.abs(local.min[0]),
            Math.abs(local.max[0]),
            Math.abs(local.min[1]),
            Math.abs(local.max[1]),
            Math.abs(local.min[2]),
            Math.abs(local.max[2])
        )
    return {
        min: [position[0] - reach, position[1] - reach, position[2] - reach],
        max: [position[0] + reach, position[1] + reach, position[2] + reach]
    }
}

/** Compose a part's transforms in order scale → rotate → translate. */
const transformedPart = (part: SculptPart): Sdf => {
    let sdf = partPrimitive(part)
    if (part.scale !== undefined) {
        sdf = scaled(sdf, assertPositive(part.scale, "scale"))
    }
    if (part.rotation !== undefined) {
        sdf = rotated(sdf, assertFiniteVec3(part.rotation, "rotation"))
    }
    if (part.position !== undefined) {
        sdf = translated(sdf, assertFiniteVec3(part.position, "position"))
    }
    return sdf
}

/**
 * Lower a scene to a single conventional (negative-inside) SDF plus a bounding
 * box that encloses the union with margin. Parts are blended with `smoothUnion`
 * (plain `union` when smoothness <= 0). The bounds are the AABB over every part,
 * expanded on all sides by `max(smoothness, 2)` (smooth-union bulges outward by
 * ~smoothness, and the wall margin must beat it) plus ~10% slack so the mesher
 * never caps the surface against the box.
 */
export const compileScene = (scene: SculptScene): { sdf: Sdf; bounds: { min: Vec3; max: Vec3 } } => {
    if (!scene.parts || scene.parts.length === 0) {
        throw new Error("scene must have at least one part")
    }
    const smoothness = scene.smoothness ?? 1
    if (!isFiniteNumber(smoothness)) {
        throw new Error("smoothness must be a finite number")
    }

    const sdfs: Sdf[] = []
    let min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
    let max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
    for (const part of scene.parts) {
        sdfs.push(transformedPart(part))
        const aabb = worldAabb(part)
        min = [Math.min(min[0], aabb.min[0]), Math.min(min[1], aabb.min[1]), Math.min(min[2], aabb.min[2])]
        max = [Math.max(max[0], aabb.max[0]), Math.max(max[1], aabb.max[1]), Math.max(max[2], aabb.max[2])]
    }

    const sdf = smoothness > 0 ? smoothUnion(smoothness, ...sdfs) : union(...sdfs)

    const margin = Math.max(smoothness, 2)
    const slack = (axis: number) => margin + 0.1 * (max[axis] - min[axis])
    const bounds = {
        min: [min[0] - slack(0), min[1] - slack(1), min[2] - slack(2)] as Vec3,
        max: [max[0] + slack(0), max[1] + slack(1), max[2] + slack(2)] as Vec3
    }
    return { sdf, bounds }
}

/**
 * Mesh a scene into a watertight {@link Manifold} via manifold's `levelSet`.
 *
 * `levelSet` is positive-inside, the OPPOSITE of sdf.ts's convention, so the
 * combined field is negated before sampling; non-finite samples are forced far
 * outside so a stray NaN can't poison the isosurface. `edgeLength` is the grid
 * spacing — cost grows ~cubically, so we use D/64 (D = largest bounds dimension)
 * with a 0.3mm floor to cap triangle count on huge scenes. The result is gated
 * with the repo's validity check; the caller owns the returned handle.
 */
export const buildSculpt = (wasm: ManifoldToplevel, scene: SculptScene): Manifold => {
    const { sdf: field, bounds } = compileScene(scene)

    // levelSet wants positive-inside: negate the conventional field. A non-finite
    // sample becomes a large negative (far outside) so it never spawns surface.
    const inside = (p: Vec3): number => {
        const d = field(p)
        return Number.isFinite(d) ? -d : -1e6
    }

    const D = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2])
    const edgeLength = Math.max(D / 64, 0.3)

    const result = wasm.Manifold.levelSet(inside, bounds, edgeLength)
    if (result.isEmpty() || result.status() !== "NoError" || result.volume() <= 0) {
        result.delete()
        throw new Error("sculpt produced an empty or invalid solid")
    }
    return result
}

/** The LLM-facing tool: a rich brief so a model can sculpt recognizable organic forms. */
export const SCULPT_TOOL: ToolDef = {
    type: "function",
    function: {
        name: "sculpt",
        description: [
            "Sculpt an organic 3D solid by blending simple primitives into one fused form, like working in clay.",
            "Compose a creature or object from overlapping parts in a single shared coordinate frame, with all",
            "positions and sizes in millimetres (x = right, y = up, z = forward/toward viewer). The parts are merged",
            "with a smooth blend so they melt into each other instead of looking like separate balls.",
            "",
            "Building blocks (use the matching params, others are ignored):",
            "- ellipsoid (radii [x,y,z]): bodies, torsos, heads, bellies — the workhorse for fleshy masses.",
            "- sphere (radius): heads, eyes, joints, small bumps like feet or ears.",
            "- capsule (a, b, radius): tails, legs, arms, necks, fingers — a rounded tube from point a to point b.",
            "- box / roundBox (halfExtents [x,y,z], rounding for roundBox): blocky structure, slabs, snouts.",
            "- cylinder (height, radius): axle along +Y for limbs, trunks, posts.",
            "",
            "Overlap parts so they fuse: a head sphere should poke INTO the body ellipsoid, not float beside it.",
            "Set `smoothness` to roughly 1-3 mm (the blend radius / weld softness): ~1 keeps detail crisp, ~3 makes",
            "everything bulbous and gooey. Per-part you may also set `position`, `rotation` (euler degrees x->y->z),",
            "and uniform `scale`.",
            "",
            "Worked example — a rat (smoothness 2):",
            "- body: ellipsoid radii [18,12,12] at [0,0,0]",
            "- head: sphere radius 8 at [22,2,0] (overlapping the front of the body)",
            "- ears: two spheres radius 3 at [24,9,5] and [24,9,-5]",
            "- tail: capsule a [-18,0,0] b [-38,4,6] radius 2 (sweeping out from the rear)",
            "- legs: four capsules radius 2.5, e.g. front-right a [12,-10,7] b [14,-2,7], mirrored for the others",
            "Adapt the same recipe for any animal/figure: one big ellipsoid trunk, a sphere head set into it,",
            "capsules for every limb/tail/neck, and small spheres or ellipsoids for ears, snout, hands and feet."
        ].join("\n"),
        parameters: {
            type: "object",
            additionalProperties: false,
            required: ["parts"],
            properties: {
                parts: {
                    type: "array",
                    minItems: 1,
                    description: "The primitives to blend into the final solid.",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["shape"],
                        properties: {
                            shape: {
                                type: "string",
                                enum: ["sphere", "ellipsoid", "box", "roundBox", "capsule", "cylinder"],
                                description: "Which primitive this part is."
                            },
                            radius: {
                                type: "number",
                                description: "Radius for sphere, capsule, or cylinder (mm)."
                            },
                            radii: {
                                type: "array",
                                items: { type: "number" },
                                minItems: 3,
                                maxItems: 3,
                                description: "Ellipsoid semi-axes [x,y,z] (mm)."
                            },
                            halfExtents: {
                                type: "array",
                                items: { type: "number" },
                                minItems: 3,
                                maxItems: 3,
                                description: "Half-sizes [x,y,z] for box or roundBox (mm)."
                            },
                            rounding: {
                                type: "number",
                                description: "Corner radius for roundBox (mm)."
                            },
                            a: {
                                type: "array",
                                items: { type: "number" },
                                minItems: 3,
                                maxItems: 3,
                                description: "Capsule start point [x,y,z] in the part's local frame (mm)."
                            },
                            b: {
                                type: "array",
                                items: { type: "number" },
                                minItems: 3,
                                maxItems: 3,
                                description: "Capsule end point [x,y,z] in the part's local frame (mm)."
                            },
                            height: {
                                type: "number",
                                description: "Cylinder height along its +Y axis (mm)."
                            },
                            position: {
                                type: "array",
                                items: { type: "number" },
                                minItems: 3,
                                maxItems: 3,
                                description: "Where to place the part [x,y,z] (mm)."
                            },
                            rotation: {
                                type: "array",
                                items: { type: "number" },
                                minItems: 3,
                                maxItems: 3,
                                description: "Euler rotation in degrees, applied x then y then z."
                            },
                            scale: {
                                type: "number",
                                description: "Uniform scale multiplier for the part."
                            }
                        }
                    }
                },
                smoothness: {
                    type: "number",
                    description:
                        "Blend radius in mm that softens how parts weld together (~1 crisp, ~3 gooey). Default 1."
                }
            }
        }
    }
}
