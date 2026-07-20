import { createFileRoute } from "@tanstack/react-router";

import { RoutinesPage } from "../components/routines/RoutinesPage";
import { SidebarInset } from "../components/ui/sidebar";

function RoutinesRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background">
      <RoutinesPage />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/routines")({
  component: RoutinesRouteView,
});
