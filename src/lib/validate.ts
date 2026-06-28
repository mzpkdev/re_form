import type { Manifold } from "manifold-3d"

/**
 * Shared geometry-validity gate and error-formatting helpers.
 *
 * A Manifold is considered a VALID solid when it is non-empty, in the
 * "NoError" state, and encloses positive volume. This single predicate was
 * previously inlined across edits.ts, model.ts, and sculpt.ts; consolidating it
 * here keeps the definition from drifting. React-free by design.
 */

/** True when `m` is a valid solid: non-empty, NoError status, and positive volume. */
export const isValidSolid = (m: Manifold): boolean => !m.isEmpty() && m.status() === "NoError" && m.volume() > 0

/**
 * Gate a freshly-produced Manifold: when it is not a valid solid, delete the
 * handle (so the degenerate result never leaks) and throw `new Error(message)`.
 * Mirrors the delete-then-throw the call sites used to inline.
 */
export const assertValidSolid = (m: Manifold, message: string): void => {
    if (!isValidSolid(m)) {
        m.delete()
        throw new Error(message)
    }
}

/** Normalise a caught error into the `Error: <message>` string the tool layer returns. */
export const formatToolError = (error: unknown): string => `Error: ${(error as Error).message}`
