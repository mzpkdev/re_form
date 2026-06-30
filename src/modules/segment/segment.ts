import { decomposeBodies } from "./decompose"
import { weldAndAnalyze } from "./mesh"
import { growRegions } from "./regionGrow"
import type { MeshTopology, Segmentation, SegmentInput, ShapeGroup, ShapeKind, ShapeParams } from "./types"

/**
 * Top-level orchestrator: weld once, run the enabled tiers over the welded faces,
 * and assemble a complete `Segmentation`.
 *
 * THIN-ORCHESTRATOR CONTRACT — every later phase ADDS a tier module and FLIPS ONE
 * FLAG here; it never rewrites this file. The tiers run as a fixed sequence of
 * flag-guarded seams, each of which only ever WRITES the faces it claims into the
 * shared `assignment` (and never re-reads another tier's labels), then a single
 * `unknown` bucket sweeps up whatever is still `-1`. Group assembly + the
 * completeness invariant live below all of them, so a tier author touches exactly
 * their own seam.
 *
 * CANONICAL FACE SPACE — `weldAndAnalyze` is called once and `topo.triangles` is
 * the welded face list every group's `triangleIndices` indexes. This is the only
 * face space in the module: export and the viewport slice the welded faces by
 * these indices, so tiers MUST report welded-face indices, never raw-soup ones.
 *
 * M0 LIVE PATH — all tier flags default off, so no tier claims any face and every
 * face falls through to a single `"unknown"` group covering `[0, F)`.
 *
 * BODY→PATCH HIERARCHY (M2.3) — the body/feature hierarchy rides on `parentId`,
 * NOT on separate container groups, so `assertComplete` stays an honest leaf
 * partition. With `tiers.regions` ON, bodies are NOT emitted as groups: each
 * `decomposeBodies` component mints one id (`faceToBody`) used only as a `parentId`
 * target, and the emitted leaves are the `patch` groups (parented to their body)
 * plus the `unknown` bucket. With `tiers.regions` OFF (M1), bodies remain leaf
 * groups exactly as before (parentId null) — that path is byte-unchanged.
 */
export const segment = (input: SegmentInput): Segmentation => {
    // 1. Weld once. `topo.triangles` is the canonical welded face space; F is its
    //    face count and the length every membership set is reconciled against.
    const topo = weldAndAnalyze(input.geometry)
    const F = topo.faceCount

    // 2. Per-face owning-group index, `-1` = unclaimed. Tiers fill it in; the
    //    `unknown` bucket claims the remainder.
    const assignment = new Int32Array(F).fill(-1)

    const groups: ShapeGroup[] = []

    // Claim a set of welded faces for a new group: write the group's index into
    // `assignment` for each face, then push the assembled group. Faces already
    // owned by an earlier group are skipped, so this never double-claims — tiers
    // stay order-independent and the disjointness invariant holds by construction.
    // `parentId` carries the body→feature hierarchy (M2.3): a patch passes its
    // body's minted id, a leaf body/unknown passes null (the default).
    const claim = (
        faces: Iterable<number>,
        kind: ShapeKind,
        label: string,
        params: ShapeParams,
        parentId: string | null = null
    ): void => {
        const groupIndex = groups.length
        const claimed: number[] = []
        for (const f of faces) {
            if (assignment[f] !== -1) continue
            assignment[f] = groupIndex
            claimed.push(f)
        }
        groups.push(makeGroup(topo, kind, label, params, claimed, parentId))
    }

    // Face → owning body id, or null when no body owns it. Populated only when
    // BOTH bodies and regions are on (the body-as-parent path); it carries the
    // hierarchy onto patches/unknown via `parentId`. Stays all-null otherwise.
    const faceToBody: (string | null)[] = new Array(F).fill(null)

    // ── Tier 1: bodies ─────────────────────────────────────────────────────────
    // Wired now (M1.1 implements `decomposeBodies` for real; the hook flips this
    // flag on). M0 tests leave it off, so the stub is never invoked here.
    //
    // Two shapes depending on `tiers.regions`:
    //  • regions OFF (M1): bodies are LEAF groups — claimed as `body` kind with a
    //    null parent, exactly as M1 shipped. This path is byte-unchanged.
    //  • regions ON (M2): bodies are PARENTS only — no body group is emitted;
    //    instead each component mints one id recorded in `faceToBody`, and the
    //    region seam below parents its patches to those ids.
    if (input.tiers.bodies) {
        // decompose needs the manifold singleton; the flag is only ever set on the
        // path that supplies it, so a missing `wasm` here is a wiring bug.
        if (!input.wasm) {
            throw new Error("segment: tiers.bodies requires input.wasm (the manifold singleton)")
        }
        const bodies = decomposeBodies(input.wasm, input.geometry)
        if (input.tiers.regions) {
            // Bodies become parents only: mint one id per component and stamp its
            // faces. Emit NO body group — they exist solely as `parentId` targets,
            // so the leaf partition (patches + unknown) is unchanged.
            for (const faces of bodies) {
                const bodyId = crypto.randomUUID()
                for (const f of faces) {
                    faceToBody[f] = bodyId
                }
            }
        } else {
            // M1 behaviour: bodies are leaf groups (parentId null).
            bodies.forEach((faces, i) => {
                claim(faces, "body", `Body ${i + 1}`, { kind: "body" })
            })
        }
    }

    // ── Tier 3: primitives ───────────────────────────────────────────────────────
    // M3.4 enables: RANSAC first per §6.6 ordering (detect primitives over the
    // sampled cloud → votes/conflict-resolution → CC-split → boundary cleanup),
    // claiming each fitted plane/cylinder/sphere/cone group out of the -1 faces.
    // Sits BEFORE regions because §6.6 runs RANSAC first. Do NOT reference
    // ransac/fit yet — they do not exist.
    if (input.tiers.primitives) {
        // M3.4 seam — intentionally empty until Tier 3 lands.
    }

    // ── Tier 2: regions ──────────────────────────────────────────────────────────
    // Wired now (M2.3): grow the still-`-1` faces into smooth patches bounded by
    // creases, and emit each as a leaf `patch` group. Region growth can't cross a
    // disconnected-body boundary (those edges are `-1`/`-2` in `faceAdjacency`), so
    // every patch's faces share one body — `faceToBody[patch[0]]` is the whole
    // patch's parent. `faceToBody` is all-null unless bodies are also on, so a
    // regions-only run simply produces top-level patches.
    if (input.tiers.regions) {
        const { patches } = growRegions(topo, assignment, input.params)
        patches.forEach((patch, i) => {
            claim(patch, "patch", `Patch ${i + 1}`, { kind: "patch" }, faceToBody[patch[0]] ?? null)
        })
    }

    // 4. Unknown bucket — one group for every face no enabled tier claimed. In M0
    //    (all flags off) this is the whole mesh. When regions are on, parent it to
    //    its first leftover face's body so the bucket sits under the hierarchy too;
    //    leftovers are rare (regionGrow's MIN_PATCH_FACES is 1). With regions off
    //    `faceToBody` is all-null, so `parentId` stays null — M1 behaviour.
    const leftover: number[] = []
    for (let f = 0; f < F; f++) {
        if (assignment[f] === -1) leftover.push(f)
    }
    if (leftover.length > 0) {
        claim(leftover, "unknown", "Unknown", { kind: "unknown" }, faceToBody[leftover[0]] ?? null)
    }

    // 5. Completeness invariant: the groups partition `[0, F)` exactly — total
    //    membership is F, sets are pairwise disjoint, and the union is all faces.
    assertComplete(groups, F)

    return { groups, triangleCount: F, params: input.params }
}

// Placeholder highlight colour; real distinct hues are assigned in M1.2
// (`groupColors.ts`). Kept neutral so an un-recoloured group is still visible.
const PLACEHOLDER_COLOR: [number, number, number] = [0.5, 0.5, 0.5]

/**
 * Assemble a `ShapeGroup` from a list of welded face indices: a stable id, the
 * given kind/label/params, a placeholder colour, the membership as an
 * `Int32Array`, the REQUIRED axis-aligned `bbox` over the welded positions of
 * those faces (with `centroid` as the mean of the same corners), and the optional
 * `parentId` carrying the body→feature hierarchy (null for a leaf/top-level group).
 * An empty face list yields a zeroed bbox/centroid — valid, though the completeness
 * assembly never emits an empty group.
 */
const makeGroup = (
    topo: MeshTopology,
    kind: ShapeKind,
    label: string,
    params: ShapeParams,
    faces: number[],
    parentId: string | null
): ShapeGroup => {
    const { positions, triangles } = topo
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let sumX = 0
    let sumY = 0
    let sumZ = 0
    let cornerCount = 0

    for (const f of faces) {
        for (let k = 0; k < 3; k++) {
            const base = triangles[3 * f + k] * 3
            const x = positions[base]
            const y = positions[base + 1]
            const z = positions[base + 2]
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (z < minZ) minZ = z
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
            if (z > maxZ) maxZ = z
            sumX += x
            sumY += y
            sumZ += z
            cornerCount++
        }
    }

    if (cornerCount === 0) {
        minX = minY = minZ = maxX = maxY = maxZ = 0
    }

    return {
        id: crypto.randomUUID(),
        kind,
        label,
        color: [...PLACEHOLDER_COLOR],
        triangleIndices: Int32Array.from(faces),
        params,
        bbox: {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ]
        },
        centroid: cornerCount === 0 ? [0, 0, 0] : [sumX / cornerCount, sumY / cornerCount, sumZ / cornerCount],
        parentId
    }
}

/**
 * Assert the §6.6 completeness invariant and throw a clear error if violated: the
 * group membership sets partition `[0, F)` — sizes sum to `F`, no face appears in
 * two groups, and every face in `[0, F)` appears in exactly one.
 */
const assertComplete = (groups: ShapeGroup[], F: number): void => {
    const seen = new Int8Array(F)
    let total = 0
    for (const group of groups) {
        for (const f of group.triangleIndices) {
            if (f < 0 || f >= F) {
                throw new Error(`segment: completeness violated — face ${f} out of range [0, ${F})`)
            }
            if (seen[f] === 1) {
                throw new Error(`segment: completeness violated — face ${f} claimed by more than one group`)
            }
            seen[f] = 1
            total++
        }
    }
    if (total !== F) {
        throw new Error(`segment: completeness violated — Σ triangleIndices = ${total}, expected F = ${F}`)
    }
}
