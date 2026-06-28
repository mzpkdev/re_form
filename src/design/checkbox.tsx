import { Checkbox as Ark } from "@ark-ui/react/checkbox"
import type { ComponentProps } from "react"
import { cn } from "./cn"

const Root = ({ className, ...props }: ComponentProps<typeof Ark.Root>) => (
    <Ark.Root className={cn("flex items-center gap-2", className)} {...props} />
)

const Control = ({ className, ...props }: ComponentProps<typeof Ark.Control>) => (
    <Ark.Control
        className={cn(
            "flex size-5 items-center justify-center rounded-control border border-border bg-surface text-accent-foreground transition-colors checked:border-accent checked:bg-accent",
            className
        )}
        {...props}
    />
)

const Label = ({ className, ...props }: ComponentProps<typeof Ark.Label>) => (
    <Ark.Label className={cn("text-sm text-foreground select-none", className)} {...props} />
)

/** 1:1 with Ark UI's Checkbox, styled with design tokens. Put your check icon inside `Indicator`. */
export const Checkbox = {
    Root,
    Control,
    Indicator: Ark.Indicator,
    HiddenInput: Ark.HiddenInput,
    Label,
    Group: Ark.Group,
    Context: Ark.Context
}
