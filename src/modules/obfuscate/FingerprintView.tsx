import { cn } from "../../design/cn"
import { identicon } from "./fingerprint"

/**
 * Visual fingerprint: a symmetric identicon + short hex digest. Identical
 * exported bytes render the same sigil; any change repaints it — so a sigil that
 * flips after Obfuscate is proof the file really differs.
 */
export const FingerprintView = ({ digest }: { digest: string }) => {
    const { cells, hue } = identicon(digest)
    // Hash-derived, so it cannot be a static design token — the one inline style here.
    const color = `hsl(${hue} 70% 55%)`
    const tiles = cells.map((on, i) => ({ id: `tile-${i}`, on }))
    return (
        <div className="flex items-center gap-4">
            <div className="grid w-24 shrink-0 grid-cols-5 gap-1">
                {tiles.map((tile) => (
                    <div
                        key={tile.id}
                        className={cn("aspect-square rounded-sm", tile.on ? null : "bg-on-surface/10")}
                        style={tile.on ? { backgroundColor: color } : undefined}
                    />
                ))}
            </div>
            <code className="break-all font-mono text-tiny text-tertiary">{digest.slice(0, 16)}</code>
        </div>
    )
}
