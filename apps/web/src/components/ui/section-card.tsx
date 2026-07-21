import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "../../lib/utils";

export interface SectionCardProps extends Omit<ComponentPropsWithoutRef<"section">, "title"> {
  readonly title: ReactNode;
  readonly icon?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly cardClassName?: string;
}

/** Product-standard eyebrow heading paired with a bordered content card. */
export function SectionCard({
  title,
  icon,
  headerAction,
  cardClassName,
  children,
  className,
  ...sectionProps
}: SectionCardProps) {
  return (
    <section {...sectionProps} className={cn("space-y-2.5", className)}>
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/50">
          <span className="inline-block h-px w-3 bg-border" aria-hidden />
          {icon}
          {title}
        </h2>
        {headerAction ? (
          <div className="flex h-5 min-w-5 items-center justify-end">{headerAction}</div>
        ) : null}
      </div>
      <div
        className={cn(
          "relative overflow-visible rounded-2xl border bg-card text-card-foreground shadow-sm/4 not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:shadow-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
          cardClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}
