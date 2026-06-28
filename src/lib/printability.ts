import type { Manifold, ManifoldToplevel } from "manifold-3d"
import { isValidSolid } from "./validate"

/**
 * Pure "will this print?" validation gate. React-free by design.
 *
 * Given a built Manifold, produce a {@link PrintabilityReport} describing
 * whether the geometry is fit for FDM printing. This NEVER throws for
 * unprintable geometry — problems are collected as {@link PrintabilityIssue}s
 * and returned. `ok` is true only when no "error"-level issue was raised.
 *
 * The caller still owns `m` and is responsible for deleting it; every
 * intermediate Manifold this module allocates (decomposed pieces, the eroded
 * probe, the probing sphere) is deleted before returning.
 */

/** A single printability finding. `error`-level findings make a report not-ok. */
export type PrintabilityIssue = { level: "error" | "warning"; code: string; message: string }

/** The outcome of a {@link checkPrintability} run. */
export type PrintabilityReport = {
    ok: boolean
    issues: PrintabilityIssue[]
    dimensions: { x: number; y: number; z: number }
    volume: number
}

/** Options for {@link checkPrintability}. */
type PrintabilityOptions = {
    /** Smallest printable feature, in mm. Default 0.8. */
    minFeature?: number
    /** Printer build volume [x, y, z], in mm. Default [256, 256, 256]. */
    buildVolume?: [number, number, number]
}

const DEFAULT_MIN_FEATURE = 0.8
const DEFAULT_BUILD_VOLUME: [number, number, number] = [256, 256, 256]

/** Circular segment count for the erosion probe sphere — smooth enough to approximate a ball. */
const PROBE_SEGMENTS = 48

/**
 * Validate `m` for printability. Returns a report; collects issues rather than
 * throwing. `ok === true` ⇔ no "error"-level issue. The caller retains
 * ownership of `m`; all handles allocated here are deleted before return.
 */
export const checkPrintability = (
    wasm: ManifoldToplevel,
    m: Manifold,
    opts?: PrintabilityOptions
): PrintabilityReport => {
    const minFeature = opts?.minFeature ?? DEFAULT_MIN_FEATURE
    const buildVolume = opts?.buildVolume ?? DEFAULT_BUILD_VOLUME
    const issues: PrintabilityIssue[] = []

    // Guard the broken-handle cases first: calling boundingBox() / decompose()
    // on a non-manifold or empty handle is not safe, so bail out early with the
    // structural errors and zeroed measurements.
    if (m.status() !== "NoError") {
        issues.push({
            level: "error",
            code: "non_manifold",
            message: `Geometry is not a valid manifold (status: ${m.status()}).`
        })
        return { ok: false, issues, dimensions: { x: 0, y: 0, z: 0 }, volume: 0 }
    }
    if (m.isEmpty() || m.volume() <= 0) {
        issues.push({
            level: "error",
            code: "empty",
            message: "Geometry is empty — there is nothing to print."
        })
        return { ok: false, issues, dimensions: { x: 0, y: 0, z: 0 }, volume: 0 }
    }

    const volume = m.volume()
    const box = m.boundingBox()
    const dimensions = {
        x: box.max[0] - box.min[0],
        y: box.max[1] - box.min[1],
        z: box.max[2] - box.min[2]
    }

    // Multiple decomposed pieces: this is AMBIGUOUS. decompose() returns one
    // handle per connected boundary surface, so it counts BOTH genuinely
    // separate solids (floating islands) AND the inner cavity wall of a single
    // closed hollow shell — a sealed shell reports 2 pieces (outer skin + void
    // boundary) even though it is one connected solid. We must tell them apart.
    //
    // Discriminator: bounding-box NEST TEST, NOT genus.
    //   We measured genus() on this manifold-3d build: a closed cube shell AND
    //   two disjoint cubes BOTH report genus === -1 (manifold derives genus from
    //   the global Euler characteristic across all components, so two genus-0
    //   solids and one shell collapse to the same value). So `genus() < 0` CANNOT
    //   discriminate here. Instead, an enclosed void shows up as a piece whose
    //   bounding box is STRICTLY contained within another piece's box (the void
    //   boundary sits inside the outer skin); genuinely separate solids never nest
    //   this way. LIMITS: this is a bbox approximation — two real solids where one
    //   is parked inside the other's bbox-but-not-its-volume (e.g. a small cube in
    //   the concavity of a C-shape) could be mis-read as an enclosed void; a true
    //   enclosed-void check would need point-in-solid containment, which manifold
    //   does not expose cheaply.
    const pieces = m.decompose()
    try {
        if (pieces.length > 1) {
            // decompose() hands back fresh Manifold handles; read each piece's box
            // before deleting (handles are freed in the finally below).
            const boxes = pieces.map((piece) => piece.boundingBox())
            const eps = 1e-9
            const strictlyInside = (inner: number, outer: number): boolean => {
                const within =
                    boxes[inner].min[0] > boxes[outer].min[0] - eps &&
                    boxes[inner].min[1] > boxes[outer].min[1] - eps &&
                    boxes[inner].min[2] > boxes[outer].min[2] - eps &&
                    boxes[inner].max[0] < boxes[outer].max[0] + eps &&
                    boxes[inner].max[1] < boxes[outer].max[1] + eps &&
                    boxes[inner].max[2] < boxes[outer].max[2] + eps
                if (!within) return false
                // Require a genuinely smaller box on at least one face, so two
                // coincident boxes are not read as nesting.
                return (
                    boxes[inner].min[0] > boxes[outer].min[0] + eps ||
                    boxes[inner].min[1] > boxes[outer].min[1] + eps ||
                    boxes[inner].min[2] > boxes[outer].min[2] + eps ||
                    boxes[inner].max[0] < boxes[outer].max[0] - eps ||
                    boxes[inner].max[1] < boxes[outer].max[1] - eps ||
                    boxes[inner].max[2] < boxes[outer].max[2] - eps
                )
            }
            let nested = false
            for (let i = 0; i < boxes.length && !nested; i++) {
                for (let j = 0; j < boxes.length; j++) {
                    if (i !== j && strictlyInside(i, j)) {
                        nested = true
                        break
                    }
                }
            }

            if (nested) {
                // One connected solid wrapping a sealed cavity. This still PRINTS
                // (it is watertight) — it just risks trapping support/powder/resin
                // — so it is a WARNING and `ok` stays true.
                issues.push({
                    level: "warning",
                    code: "enclosed_void",
                    message:
                        "Sealed internal void detected; may trap support/powder — add a drain hole or use an open shell."
                })
            } else {
                // Genuinely separate solids: a freestanding piece can float off the
                // plate, and most slicers treat these as unintended separate objects.
                issues.push({
                    level: "error",
                    code: "disconnected",
                    message: `Geometry has ${pieces.length} disconnected pieces; expected a single connected solid.`
                })
            }
        }
    } finally {
        // decompose() hands back fresh Manifold handles — delete every one.
        for (const piece of pieces) {
            piece.delete()
        }
    }

    // Exceeds build volume: any axis larger than the matching printer axis.
    const axes: ["x" | "y" | "z", number, number][] = [
        ["x", dimensions.x, buildVolume[0]],
        ["y", dimensions.y, buildVolume[1]],
        ["z", dimensions.z, buildVolume[2]]
    ]
    const oversizedAxes = axes.filter(([, size, limit]) => size > limit)
    if (oversizedAxes.length > 0) {
        const detail = oversizedAxes
            .map(([axis, size, limit]) => `${axis} ${size.toFixed(1)}mm > ${limit}mm`)
            .join(", ")
        issues.push({
            level: "warning",
            code: "exceeds_build_volume",
            message: `Geometry exceeds the build volume (${detail}).`
        })
    }

    // Minimum feature: the smallest bounding-box dimension is a coarse upper
    // bound on the thinnest part of the model. If even that is below the
    // printable feature size, the part almost certainly won't print cleanly.
    const smallestDim = Math.min(dimensions.x, dimensions.y, dimensions.z)
    if (smallestDim < minFeature) {
        issues.push({
            level: "warning",
            code: "min_feature",
            message: `Smallest dimension ${smallestDim.toFixed(2)}mm is below the minimum feature size (${minFeature}mm).`
        })
    }

    // Thin-wall detection (BEST-EFFORT, APPROXIMATE).
    //
    // manifold has no native min-wall-thickness query, so we approximate it via
    // morphological erosion: subtract a ball of radius minFeature/2 from the
    // solid (Minkowski difference). Any wall thinner than minFeature is fully
    // consumed by the erosion. If the eroded solid vanishes — or shrinks to a
    // tiny fraction of the original volume — the model is dominated by walls at
    // or below minFeature.
    //
    // This is only an estimate: it is sensitive to PROBE_SEGMENTS, it can flag
    // legitimately small-but-printable parts, and the volume threshold below is
    // a heuristic, not a guarantee. Wrapped in try/catch so a failure of the
    // (relatively expensive) Minkowski op never crashes the gate.
    try {
        const probeRadius = minFeature / 2
        const probe = wasm.Manifold.sphere(probeRadius, PROBE_SEGMENTS)
        const eroded = m.minkowskiDifference(probe)
        try {
            // ~1% of the original volume — below this the part is essentially
            // all thin wall once a half-feature ball is eroded away.
            const thinThreshold = volume * 0.01
            if (eroded.isEmpty() || !isValidSolid(eroded) || eroded.volume() < thinThreshold) {
                issues.push({
                    level: "warning",
                    code: "thin_wall",
                    message: `Walls may be thinner than the minimum feature size (~${minFeature}mm); printed walls could be fragile or fail. (approximate)`
                })
            }
        } finally {
            eroded.delete()
            probe.delete()
        }
    } catch {
        // Erosion probe failed (e.g. Minkowski blew up on awkward geometry) —
        // thin walls are simply not reported. Never crash the printability gate.
    }

    const ok = !issues.some((issue) => issue.level === "error")
    return { ok, issues, dimensions, volume }
}
