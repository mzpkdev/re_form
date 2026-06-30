import { ColorPicker as Ark } from "@ark-ui/react/color-picker"
import type { ComponentProps } from "react"
import { cn } from "./cn"

const Control = ({ className, ...props }: ComponentProps<typeof Ark.Control>) => (
    <Ark.Control className={cn("flex items-center gap-2", className)} {...props} />
)

const Trigger = ({ className, ...props }: ComponentProps<typeof Ark.Trigger>) => (
    <Ark.Trigger
        className={cn(
            "flex size-6 items-center justify-center rounded-control border border-border bg-surface transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
            className
        )}
        {...props}
    />
)

const Positioner = ({ className, ...props }: ComponentProps<typeof Ark.Positioner>) => (
    <Ark.Positioner className={cn("z-50", className)} {...props} />
)

const Content = ({ className, ...props }: ComponentProps<typeof Ark.Content>) => (
    <Ark.Content
        className={cn(
            "flex w-56 flex-col gap-3 rounded-control border border-border bg-surface-raised p-3 text-foreground shadow-xl",
            className
        )}
        {...props}
    />
)

const Area = ({ className, ...props }: ComponentProps<typeof Ark.Area>) => (
    <Ark.Area className={cn("h-32 w-full overflow-hidden rounded-control", className)} {...props} />
)

const AreaThumb = ({ className, ...props }: ComponentProps<typeof Ark.AreaThumb>) => (
    <Ark.AreaThumb className={cn("size-3 rounded-full border-2 border-white shadow-md", className)} {...props} />
)

const ChannelSlider = ({ className, ...props }: ComponentProps<typeof Ark.ChannelSlider>) => (
    <Ark.ChannelSlider className={cn("relative h-3 w-full rounded-full", className)} {...props} />
)

const ChannelSliderThumb = ({ className, ...props }: ComponentProps<typeof Ark.ChannelSliderThumb>) => (
    <Ark.ChannelSliderThumb
        className={cn("size-3 rounded-full border-2 border-white shadow-md", className)}
        {...props}
    />
)

const SwatchGroup = ({ className, ...props }: ComponentProps<typeof Ark.SwatchGroup>) => (
    <Ark.SwatchGroup className={cn("flex flex-wrap gap-1.5", className)} {...props} />
)

const SwatchTrigger = ({ className, ...props }: ComponentProps<typeof Ark.SwatchTrigger>) => (
    <Ark.SwatchTrigger
        className={cn(
            "size-5 rounded-control border border-border transition-transform focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
            className
        )}
        {...props}
    />
)

const Swatch = ({ className, ...props }: ComponentProps<typeof Ark.Swatch>) => (
    <Ark.Swatch className={cn("size-full rounded-control", className)} {...props} />
)

const ValueSwatch = ({ className, ...props }: ComponentProps<typeof Ark.ValueSwatch>) => (
    <Ark.ValueSwatch className={cn("size-6 rounded-control border border-border", className)} {...props} />
)

const Label = ({ className, ...props }: ComponentProps<typeof Ark.Label>) => (
    <Ark.Label className={cn("text-sm font-medium text-foreground", className)} {...props} />
)

/** 1:1 with Ark UI's ColorPicker, styled with design tokens. Compose exactly like the Ark API. */
export const ColorPicker = {
    Root: Ark.Root,
    Label,
    Control,
    Trigger,
    Positioner,
    Content,
    Area,
    AreaBackground: Ark.AreaBackground,
    AreaThumb,
    ChannelSlider,
    ChannelSliderTrack: Ark.ChannelSliderTrack,
    ChannelSliderThumb,
    TransparencyGrid: Ark.TransparencyGrid,
    SwatchGroup,
    SwatchTrigger,
    Swatch,
    SwatchIndicator: Ark.SwatchIndicator,
    ValueSwatch,
    HiddenInput: Ark.HiddenInput,
    Context: Ark.Context
}
