"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const toggleVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base text-foreground outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 data-pressed:bg-input/64 data-pressed:text-accent-foreground md:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-11 min-w-11 px-[calc(--spacing(2)-1px)] md:h-8 md:min-w-8",
        lg: "h-12 min-w-12 px-[calc(--spacing(2.5)-1px)] md:h-9 md:min-w-9",
        sm: "h-11 min-w-11 px-[calc(--spacing(1.5)-1px)] md:h-7 md:min-w-7",
        xs: "h-11 min-w-11 px-[calc(--spacing(1)-1px)] md:h-6 md:min-w-6 rounded-md",
      },
      variant: {
        default: "border-transparent",
        ghost:
          "border-transparent text-foreground shadow-none [:disabled,:active,[data-pressed]]:shadow-none before:shadow-none data-pressed:bg-accent data-pressed:text-accent-foreground disabled:opacity-100 disabled:text-muted-foreground disabled:[&_svg]:opacity-100",
        outline:
          "border-input bg-background not-dark:bg-clip-padding shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:data-pressed:bg-input dark:hover:bg-input/64 dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] dark:not-disabled:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/2%)] [:disabled,:active,[data-pressed]]:shadow-none",
      },
    },
  },
);

function Toggle({
  className,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      className={cn(toggleVariants({ className, size, variant }))}
      data-slot="toggle"
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
