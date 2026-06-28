import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Renders a settled assistant reply as Markdown (GFM: tables, strikethrough,
 * task lists, autolinks). Raw HTML stays off — react-markdown's default — so
 * model output can't inject markup. Each element is styled inline against the
 * design tokens since there's no typography plugin.
 */
export const Markdown = ({ children }: { children: string }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
            p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
            h1: ({ children }) => (
                <h1 className="mt-3 mb-2 font-mono text-title-md text-on-surface first:mt-0">{children}</h1>
            ),
            h2: ({ children }) => (
                <h2 className="mt-3 mb-2 font-mono text-title-md text-on-surface first:mt-0">{children}</h2>
            ),
            h3: ({ children }) => (
                <h3 className="mt-3 mb-1 font-mono text-body-sm text-on-surface first:mt-0">{children}</h3>
            ),
            ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
            strong: ({ children }) => <strong className="font-mono font-semibold text-on-surface">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            a: ({ children, href }) => (
                <a className="text-primary underline" href={href} target="_blank" rel="noreferrer">
                    {children}
                </a>
            ),
            // `pre` carries the block background/padding; reset the wrapped `code`
            // so a fenced block doesn't double up the inline-code chrome.
            code: ({ children, className }) => (
                <code
                    className={`font-mono text-mono-data ${className?.includes("language-") ? "" : "bg-surface-container px-1 py-0.5"}`}
                >
                    {children}
                </code>
            ),
            pre: ({ children }) => (
                <pre className="my-2 overflow-x-auto bg-surface-container p-3 font-mono text-mono-data chamfer">
                    {children}
                </pre>
            ),
            blockquote: ({ children }) => (
                <blockquote className="my-2 border-l-2 border-primary pl-3 text-tertiary">{children}</blockquote>
            ),
            hr: () => <hr className="my-3 border-on-surface/10" />,
            table: ({ children }) => (
                <div className="my-2 overflow-x-auto">
                    <table className="w-full border-collapse border border-on-surface/10">{children}</table>
                </div>
            ),
            th: ({ children }) => (
                <th className="border border-on-surface/10 px-2 py-1 text-left font-mono font-semibold">{children}</th>
            ),
            td: ({ children }) => <td className="border border-on-surface/10 px-2 py-1">{children}</td>
        }}
    >
        {children}
    </ReactMarkdown>
)
