import { Dialog as Ark } from "@ark-ui/react/dialog"
import type { ComponentProps } from "react"
import { cn } from "./cn"

const Backdrop = ({ className, ...props }: ComponentProps<typeof Ark.Backdrop>) => (
    <Ark.Backdrop className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm", className)} {...props} />
)

const Positioner = ({ className, ...props }: ComponentProps<typeof Ark.Positioner>) => (
    <Ark.Positioner className={cn("fixed inset-0 flex items-center justify-center p-4", className)} {...props} />
)

const Content = ({ className, ...props }: ComponentProps<typeof Ark.Content>) => (
    <Ark.Content
        className={cn(
            "w-full max-w-md rounded-control border border-border bg-surface-raised p-6 text-foreground shadow-xl",
            className
        )}
        {...props}
    />
)

const Title = ({ className, ...props }: ComponentProps<typeof Ark.Title>) => (
    <Ark.Title className={cn("text-lg font-semibold text-foreground", className)} {...props} />
)

const Description = ({ className, ...props }: ComponentProps<typeof Ark.Description>) => (
    <Ark.Description className={cn("mt-1 text-sm text-muted", className)} {...props} />
)

/** 1:1 with Ark UI's Dialog, styled with design tokens. Compose exactly like the Ark API. */
export const Dialog = {
    Root: Ark.Root,
    Trigger: Ark.Trigger,
    Backdrop,
    Positioner,
    Content,
    Title,
    Description,
    CloseTrigger: Ark.CloseTrigger,
    Context: Ark.Context
}
