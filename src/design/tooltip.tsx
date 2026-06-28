import { Tooltip as Ark } from "@ark-ui/react/tooltip"
import type { ComponentProps } from "react"
import { cn } from "./cn"

const Content = ({ className, ...props }: ComponentProps<typeof Ark.Content>) => (
    <Ark.Content
        className={cn(
            "rounded-control border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground shadow-lg",
            className
        )}
        {...props}
    />
)

/** 1:1 with Ark UI's Tooltip, styled with design tokens. Wrap content in `Positioner`. */
export const Tooltip = {
    Root: Ark.Root,
    Trigger: Ark.Trigger,
    Positioner: Ark.Positioner,
    Content,
    Arrow: Ark.Arrow,
    ArrowTip: Ark.ArrowTip,
    Context: Ark.Context
}
