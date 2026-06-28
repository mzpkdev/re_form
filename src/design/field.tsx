import { Field as Ark } from "@ark-ui/react/field"
import type { ComponentProps } from "react"
import { cn } from "./cn"

const Root = ({ className, ...props }: ComponentProps<typeof Ark.Root>) => (
    <Ark.Root className={cn("flex flex-col gap-1.5", className)} {...props} />
)

const Label = ({ className, ...props }: ComponentProps<typeof Ark.Label>) => (
    <Ark.Label className={cn("text-sm font-medium text-foreground", className)} {...props} />
)

const Input = ({ className, ...props }: ComponentProps<typeof Ark.Input>) => (
    <Ark.Input
        className={cn(
            "rounded-control border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
            className
        )}
        {...props}
    />
)

const HelperText = ({ className, ...props }: ComponentProps<typeof Ark.HelperText>) => (
    <Ark.HelperText className={cn("text-xs text-muted", className)} {...props} />
)

const ErrorText = ({ className, ...props }: ComponentProps<typeof Ark.ErrorText>) => (
    <Ark.ErrorText className={cn("text-xs text-danger", className)} {...props} />
)

/** 1:1 with Ark UI's Field, styled with design tokens. */
export const Field = {
    Root,
    Label,
    Input,
    Textarea: Ark.Textarea,
    HelperText,
    ErrorText,
    RequiredIndicator: Ark.RequiredIndicator,
    Context: Ark.Context
}
