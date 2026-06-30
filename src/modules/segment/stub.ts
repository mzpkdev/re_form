/**
 * Shared placeholder for not-yet-implemented module surfaces. Every M0.1 stub
 * exports a real, correctly typed signature whose body calls this so the whole
 * module compiles (the contract is stable for parallel fixers) while any actual
 * invocation fails loudly. Later milestones replace each stub body with the real
 * implementation; this helper then becomes unused and is removed.
 */
export const notImplemented = (name: string): never => {
    throw new Error(`segment: ${name} is not implemented yet`)
}
