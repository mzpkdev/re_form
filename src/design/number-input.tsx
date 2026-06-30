import { NumberInput as Ark } from "@ark-ui/react/number-input"
import type { ComponentProps } from "react"
import { cn } from "./cn"

const Root = ({ className, ...props }: ComponentProps<typeof Ark.Root>) => (
    <Ark.Root className={cn("flex flex-col gap-1.5", className)} {...props} />
)

const Label = ({ className, ...props }: ComponentProps<typeof Ark.Label>) => (
    <Ark.Label className={cn("text-sm font-medium text-foreground", className)} {...props} />
)

const Control = ({ className, ...props }: ComponentProps<typeof Ark.Control>) => (
    <Ark.Control
        className={cn(
            "flex items-stretch overflow-hidden rounded-control border border-border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40",
            className
        )}
        {...props}
    />
)

const Input = ({ className, ...props }: ComponentProps<typeof Ark.Input>) => (
    <Ark.Input
        className={cn(
            "w-full bg-transparent px-3 py-2 text-sm text-foreground tabular-nums placeholder:text-muted focus-visible:outline-none",
            className
        )}
        {...props}
    />
)

const IncrementTrigger = ({ className, ...props }: ComponentProps<typeof Ark.IncrementTrigger>) => (
    <Ark.IncrementTrigger
        className={cn(
            "flex w-7 items-center justify-center border-l border-border text-muted transition-colors hover:bg-surface-variant hover:text-foreground",
            className
        )}
        {...props}
    />
)

const DecrementTrigger = ({ className, ...props }: ComponentProps<typeof Ark.DecrementTrigger>) => (
    <Ark.DecrementTrigger
        className={cn(
            "flex w-7 items-center justify-center border-l border-border text-muted transition-colors hover:bg-surface-variant hover:text-foreground",
            className
        )}
        {...props}
    />
)

const ValueText = ({ className, ...props }: ComponentProps<typeof Ark.ValueText>) => (
    <Ark.ValueText className={cn("text-sm text-muted tabular-nums", className)} {...props} />
)

/** 1:1 with Ark UI's NumberInput, styled with design tokens. Compose exactly like the Ark API. */
export const NumberInput = {
    Root,
    Label,
    Control,
    Input,
    IncrementTrigger,
    DecrementTrigger,
    ValueText,
    Scrubber: Ark.Scrubber,
    Context: Ark.Context
}
