import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/automations")({
  beforeLoad: () => {
    throw redirect({ to: "/routines", replace: true });
  },
});
