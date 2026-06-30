import { Slider as Ark } from "@ark-ui/react/slider"
import type { ComponentProps } from "react"
import { cn } from "./cn"

const Root = ({ className, ...props }: ComponentProps<typeof Ark.Root>) => (
    <Ark.Root className={cn("flex flex-col gap-2", className)} {...props} />
)

const Label = ({ className, ...props }: ComponentProps<typeof Ark.Label>) => (
    <Ark.Label className={cn("text-sm font-medium text-foreground", className)} {...props} />
)

const ValueText = ({ className, ...props }: ComponentProps<typeof Ark.ValueText>) => (
    <Ark.ValueText className={cn("text-sm text-muted tabular-nums", className)} {...props} />
)

const Control = ({ className, ...props }: ComponentProps<typeof Ark.Control>) => (
    <Ark.Control className={cn("relative flex items-center py-2", className)} {...props} />
)

const Track = ({ className, ...props }: ComponentProps<typeof Ark.Track>) => (
    <Ark.Track className={cn("h-1.5 w-full rounded-full bg-surface-variant", className)} {...props} />
)

const Range = ({ className, ...props }: ComponentProps<typeof Ark.Range>) => (
    <Ark.Range className={cn("h-full rounded-full bg-accent", className)} {...props} />
)

const Thumb = ({ className, ...props }: ComponentProps<typeof Ark.Thumb>) => (
    <Ark.Thumb
        className={cn(
            "size-4 rounded-full border border-border bg-surface shadow-sm transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
            className
        )}
        {...props}
    />
)

const MarkerGroup = ({ className, ...props }: ComponentProps<typeof Ark.MarkerGroup>) => (
    <Ark.MarkerGroup className={cn("flex w-full justify-between", className)} {...props} />
)

const Marker = ({ className, ...props }: ComponentProps<typeof Ark.Marker>) => (
    <Ark.Marker className={cn("text-xs text-muted", className)} {...props} />
)

/** 1:1 with Ark UI's Slider, styled with design tokens. Compose exactly like the Ark API. */
export const Slider = {
    Root,
    Label,
    ValueText,
    Control,
    Track,
    Range,
    Thumb,
    MarkerGroup,
    Marker,
    HiddenInput: Ark.HiddenInput,
    Context: Ark.Context
}
