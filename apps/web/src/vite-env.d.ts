/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@synara/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly VITE_FEEDBACK_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    nativeApi?: NativeApi;
    // TODO(trunk-web-parity): migrate useful native bridge capabilities through the server.
    desktopBridge?: DesktopBridge;
  }
}
