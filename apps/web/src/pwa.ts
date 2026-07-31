import { useSyncExternalStore } from "react";

import {
  isIosBrowser,
  isStandaloneDisplayMode,
  resolvePwaInstallMethod,
  type PwaInstallMethod,
} from "./pwa.logic";

interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export interface PwaSnapshot {
  readonly installMethod: PwaInstallMethod;
  readonly installed: boolean;
  readonly online: boolean;
  readonly updateAvailable: boolean;
}

const listeners = new Set<() => void>();
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let waitingServiceWorker: ServiceWorker | null = null;
let initialized = false;
let reloadingForUpdate = false;

function detectInstalled(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const navigatorStandalone =
    "standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone;
  return isStandaloneDisplayMode({
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: navigatorStandalone === true,
  });
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return isIosBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

let snapshot: PwaSnapshot = {
  installMethod: null,
  installed: false,
  online: true,
  updateAvailable: false,
};

function emit(next: Partial<PwaSnapshot>): void {
  const updated = { ...snapshot, ...next };
  if (
    updated.installMethod === snapshot.installMethod &&
    updated.installed === snapshot.installed &&
    updated.online === snapshot.online &&
    updated.updateAvailable === snapshot.updateAvailable
  ) {
    return;
  }
  snapshot = updated;
  listeners.forEach((listener) => listener());
}

function refreshInstallState(): void {
  const installed = detectInstalled();
  emit({
    installed,
    installMethod: resolvePwaInstallMethod({
      alreadyInstalled: installed,
      browserPromptAvailable: deferredInstallPrompt !== null,
      iosBrowser: detectIos(),
    }),
  });
}

function trackRegistration(registration: ServiceWorkerRegistration): void {
  if (registration.waiting && navigator.serviceWorker.controller) {
    waitingServiceWorker = registration.waiting;
    emit({ updateAvailable: true });
  }

  registration.addEventListener("updatefound", () => {
    const installingWorker = registration.installing;
    if (!installingWorker) {
      return;
    }
    installingWorker.addEventListener("statechange", () => {
      if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
        waitingServiceWorker = installingWorker;
        emit({ updateAvailable: true });
      }
    });
  });
}

export function initializePwa(): void {
  if (initialized || typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }
  initialized = true;
  emit({ installed: detectInstalled(), online: navigator.onLine });
  refreshInstallState();

  const displayMode = window.matchMedia("(display-mode: standalone)");
  displayMode.addEventListener("change", refreshInstallState);
  window.addEventListener("online", () => emit({ online: true }));
  window.addEventListener("offline", () => emit({ online: false }));
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    refreshInstallState();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    refreshInstallState();
  });

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener(
    "load",
    () => {
      void navigator.serviceWorker
        .register("/service-worker.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          trackRegistration(registration);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              void registration.update();
            }
          });
        })
        .catch((error: unknown) => {
          console.warn("PWA service worker registration failed.", error);
        });
    },
    { once: true },
  );

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) {
      return;
    }
    reloadingForUpdate = true;
    window.location.reload();
  });
}

export function subscribePwa(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaSnapshot(): PwaSnapshot {
  return snapshot;
}

export function usePwaSnapshot(): PwaSnapshot {
  return useSyncExternalStore(subscribePwa, getPwaSnapshot, getPwaSnapshot);
}

export async function requestPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = deferredInstallPrompt;
  if (!prompt) {
    return "unavailable";
  }
  await prompt.prompt();
  const choice = await prompt.userChoice;
  deferredInstallPrompt = null;
  refreshInstallState();
  return choice.outcome;
}

export function activatePwaUpdate(): void {
  if (!waitingServiceWorker) {
    window.location.reload();
    return;
  }
  waitingServiceWorker.postMessage({ type: "SKIP_WAITING" }, { transfer: [] });
}
