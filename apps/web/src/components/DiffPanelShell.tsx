import type { ReactNode } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";

import { Spinner } from "./ui/spinner";

export type DiffPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

function getDiffPanelHeaderRowClassName(mode: DiffPanelMode) {
  const shouldUseDragRegion = isElectron && mode !== "sheet" && mode !== "embedded";
  return cn(
    "flex items-center justify-between gap-2 px-4",
    shouldUseDragRegion
      ? "workspace-topbar drag-region border-b border-border wco:pr-[calc(100vw-env(titlebar-area-width)-env(titlebar-area-x)+1em)]"
      : mode === "inline"
        ? "workspace-topbar border-b border-border"
        : "surface-subheader",
  );
}

export function DiffPanelShell(props: {
  mode: DiffPanelMode;
  header: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const shouldUseDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col bg-background",
        props.mode === "inline"
          ? "w-[42vw] min-w-[360px] max-w-[560px] shrink-0 border-l border-border"
          : "w-full",
        props.className,
      )}
    >
      {shouldUseDragRegion ? (
        <div className={getDiffPanelHeaderRowClassName(props.mode)}>{props.header}</div>
      ) : (
        <div className={getDiffPanelHeaderRowClassName(props.mode)} data-surface-subheader>
          {props.header}
        </div>
      )}
      {props.children}
    </div>
  );
}

export function DiffPanelLoadingState(props: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Spinner className="size-4 text-muted-foreground" aria-label={props.label} />
    </div>
  );
}
