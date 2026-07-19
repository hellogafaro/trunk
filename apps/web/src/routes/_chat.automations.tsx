import { createFileRoute } from "@tanstack/react-router";

import { AutomationsPage } from "../components/automations/AutomationsPage";
import { SidebarInset } from "../components/ui/sidebar";

function AutomationsRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background">
      <AutomationsPage />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/automations")({
  component: AutomationsRouteView,
});
