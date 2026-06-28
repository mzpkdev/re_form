export type ClassValue = string | number | false | null | undefined

/** Join truthy class values. Base classes are written by the design system, so consumer overrides
 *  just append — reach for tailwind-merge here only if conflicting utilities become a problem. */
export const cn = (...classes: ClassValue[]): string => classes.filter(Boolean).join(" ")
