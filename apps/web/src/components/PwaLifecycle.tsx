import { useEffect, useRef } from "react";

import { activatePwaUpdate, usePwaSnapshot } from "../pwa";
import { stackedThreadToast, toastManager } from "./ui/toast";

export function PwaLifecycle() {
  const pwa = usePwaSnapshot();
  const previousOnline = useRef(pwa.online);
  const updateToastShown = useRef(false);
  const offlineToastId = useRef<ReturnType<typeof toastManager.add> | null>(null);

  useEffect(() => {
    if (previousOnline.current === pwa.online) {
      return;
    }
    previousOnline.current = pwa.online;
    if (pwa.online) {
      if (offlineToastId.current !== null) {
        toastManager.close(offlineToastId.current);
        offlineToastId.current = null;
      }
      toastManager.add({
        type: "success",
        title: "Back online",
        description: "Trunk is reconnecting to your environments.",
        timeout: 4_000,
      });
      return;
    }
    offlineToastId.current = toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "You're offline",
        description: "Your workspace is preserved. Reconnect before sending or running tools.",
        timeout: 0,
      }),
    );
  }, [pwa.online]);

  useEffect(() => {
    if (!pwa.updateAvailable || updateToastShown.current) {
      return;
    }
    updateToastShown.current = true;
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "Trunk update ready",
        description: "Reload to use the latest version. Drafts are preserved.",
        timeout: 0,
        actionVariant: "outline",
        actionProps: {
          children: "Reload",
          onClick: activatePwaUpdate,
        },
        data: { hideCopyButton: true },
      }),
    );
  }, [pwa.updateAvailable]);

  return null;
}
