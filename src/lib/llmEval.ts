import type { Manifold } from "manifold-3d"
import { runAgentTurn } from "./agent"
import { applyEdit, EDIT_TOOLS } from "./edits"
import { initManifold } from "./manifold"
import type { ChatMessage, ToolCall } from "./openrouter"
import { streamChat } from "./openrouter"
import { checkPrintability, type PrintabilityReport } from "./printability"

/**
 * Headless LLM evaluation harness.
 *
 * Runs a single natural-language prompt through the real agent tool-loop and the
 * real manifold-3d kernel — no React, no modelStore, no viewport. It mirrors the
 * CSG-edit logic of `AssistantPanel.execute()` against a private, local
 * `current` handle so a test can ask "did the model actually build a sound,
 * printable part?" end to end. The ONLY network access happens through the
 * caller-supplied `apiKey` inside `streamChat`; with no key, nothing runs.
 *
 * Every intermediate Manifold the loop replaces is deleted; the final part is
 * returned to the caller, who owns and must `.delete()` it.
 */

/** Options for {@link evaluatePrompt}. */
export type EvaluatePromptOptions = {
    /** OpenRouter (or compatible) API key. All network access flows through this. */
    apiKey: string
    /** The natural-language CAD request to run. */
    prompt: string
    /** Model slug; defaults to the streamChat default. */
    model?: string
    /** Base URL override; defaults to the streamChat default. */
    baseUrl?: string
    /** Hard cap on tool round-trips before bailing (forwarded to runAgentTurn). */
    maxSteps?: number
}

/** The outcome of an {@link evaluatePrompt} run. */
export type EvaluatePromptResult = {
    /** True when a part was built AND its printability report is ok. */
    ok: boolean
    /** The final built solid (caller owns and must delete), or null if none. */
    manifold: Manifold | null
    /** Printability of the final solid, or null when nothing was built. */
    report: PrintabilityReport | null
    /** How many tool round-trips the loop took. */
    steps: number
}

/**
 * A minimal millimetre-CAD system prompt. Deliberately leaner than the UI's —
 * the harness only needs the model to drive the CSG tools correctly, not to
 * narrate to a user.
 */
const SYSTEM_PROMPT =
    "You are a CAD assistant that edits a single 3D solid. All units are millimetres. " +
    "To change the model you MUST call the provided tools — never describe edits you did not make. " +
    "Use create_primitive to start a new solid; add_primitive, cut_primitive, intersect_primitive, " +
    "and drill_hole to reshape it; and hollow to scoop it into a shell. " +
    "create/add/cut/intersect_primitive accept these shapes: cube, sphere, cylinder, " +
    "cone (radius_bottom, radius_top — 0 for a pointed apex — and height), tube (outer_radius, wall, height), " +
    "and chamfered_box (size_x/y/z plus chamfer). " +
    "For holes or pockets that mate with another part, pass fit: press (≈0.1 mm/side), snug (≈0.2), " +
    "or slip (≈0.4); drill_hole sizes the hole up to receive a peg and cut_primitive oversizes the pocket. " +
    "When the part is built and correct, reply briefly in prose to finish."

/**
 * Run one CAD prompt through the agent loop headlessly and report whether it
 * produced a sound, printable part.
 */
export const evaluatePrompt = async (opts: EvaluatePromptOptions): Promise<EvaluatePromptResult> => {
    const { apiKey, prompt, model, baseUrl, maxSteps } = opts
    const wasm = await initManifold()

    // The single solid being edited, owned locally. Mirrors modelStore's role in
    // the UI but kept private to this run so concurrent evals can't collide.
    let current: Manifold | null = null
    let steps = 0

    // Headless mirror of AssistantPanel.execute(): parse args, apply the CSG
    // edit against `current`, swap in the result (deleting the previous handle),
    // and return the same kind of result string the UI builds. Transform and
    // sculpt tools are no-ops here — this harness only evaluates CSG geometry.
    const execute = (call: ToolCall): string => {
        let args: unknown
        try {
            args = JSON.parse(call.function.arguments)
        } catch {
            return "Error: arguments were not valid JSON"
        }
        const name = call.function.name
        if (name === "set_transform" || name === "sculpt") {
            return `Ignored ${name} (not evaluated by the headless harness).`
        }
        try {
            const next = applyEdit(wasm, current, name, args)
            // Free the handle we are replacing before swapping in the new one.
            current?.delete()
            current = next
            const box = next.boundingBox()
            const dims = `${(box.max[0] - box.min[0]).toFixed(1)}×${(box.max[1] - box.min[1]).toFixed(1)}×${(box.max[2] - box.min[2]).toFixed(1)} mm`
            const report = checkPrintability(wasm, next)
            const printLine = report.issues.length
                ? ` Printability: ${report.issues.map((i) => `${i.level === "error" ? "✗" : "⚠"} ${i.code} (${i.message})`).join("; ")}`
                : " Printability: OK."
            return `Applied ${name}. Size ${dims}, volume ${next.volume().toFixed(1)} mm³.${printLine}`
        } catch (error) {
            return `Error: ${(error as Error).message}`
        }
    }

    const stream = (messages: ChatMessage[]) => streamChat({ apiKey, model, baseUrl, messages, tools: EDIT_TOOLS })

    const history: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
    ]

    await runAgentTurn(history, {
        stream,
        execute,
        onText: () => {},
        // Each action round-trip is one or more tool calls; count the round-trips.
        onAction: () => {
            steps += 1
        },
        maxSteps
    })

    const report = current ? checkPrintability(wasm, current) : null
    const ok = !!current && !!report?.ok
    return { ok, manifold: current, report, steps }
}
