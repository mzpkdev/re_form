import { useEffect, useRef, useState } from "react"

/**
 * Reveals `text` with a typing effect at a steady pace.
 *
 * `text` may grow over time (e.g. a streaming LLM reply): the cursor keeps
 * catching up to the latest end at `charsPerSecond`, so the effect is decoupled
 * from network chunkiness rather than restarting on every change. Mount one
 * instance per message (keyed by id) so a new reply types from the start while a
 * re-rendered finished one stays fully shown.
 */
export const Typewriter = ({
    text,
    charsPerSecond = 160,
    className,
    onDone
}: {
    text: string
    charsPerSecond?: number
    className?: string
    onDone?: () => void
}) => {
    const [shown, setShown] = useState(0)
    const shownRef = useRef(0)

    // Fire whenever the full text is revealed — including when it was already
    // fully shown the moment a handler became available, not just at the end of
    // an animation frame. The caller's handler is idempotent.
    useEffect(() => {
        if (shown >= text.length) {
            onDone?.()
        }
    }, [shown, text.length, onDone])

    useEffect(() => {
        // Text was replaced by something shorter (or reset) — snap, don't animate.
        if (shownRef.current > text.length) {
            shownRef.current = text.length
            setShown(text.length)
        }
        if (shownRef.current >= text.length) {
            return
        }

        let frame = 0
        let last = 0
        const step = (now: number) => {
            if (!last) {
                last = now
            }
            const advance = Math.floor(((now - last) / 1000) * charsPerSecond)
            if (advance > 0) {
                last = now
                shownRef.current = Math.min(text.length, shownRef.current + advance)
                setShown(shownRef.current)
            }
            if (shownRef.current < text.length) {
                frame = requestAnimationFrame(step)
            }
        }
        frame = requestAnimationFrame(step)
        return () => cancelAnimationFrame(frame)
    }, [text, charsPerSecond])

    return <span className={className}>{text.slice(0, shown)}</span>
}
