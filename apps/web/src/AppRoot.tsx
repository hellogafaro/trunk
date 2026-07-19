import { RouterProvider } from "@tanstack/react-router";

import { ServerBrowserHost } from "./browser/ServerBrowserHost";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

/**
 * Owns renderer-wide providers. The server browser host sits outside the
 * router so collaborative browser sessions survive route transitions.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      <ServerBrowserHost />
    </AppAtomRegistryProvider>
  );
}
