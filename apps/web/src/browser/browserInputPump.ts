import type { PreviewBrowserInput } from "@t3tools/contracts";

export type BrowserInputPayload = PreviewBrowserInput extends infer Input
  ? Input extends PreviewBrowserInput
    ? Omit<Input, "threadId" | "tabId">
    : never
  : never;

type PointerMove = Extract<BrowserInputPayload, { readonly kind: "pointer" }> & {
  readonly action: "move";
};
type WheelInput = Extract<BrowserInputPayload, { readonly kind: "wheel" }>;

export interface BrowserInputPump {
  readonly push: (input: BrowserInputPayload) => void;
  readonly flush: () => Promise<void>;
  readonly dispose: () => void;
}

/**
 * Keeps browser input ordered without allowing pointer traffic to build an RPC
 * backlog. Boundary and keyboard events are never dropped. Pointer movement is
 * latest-wins, while adjacent wheel events are accumulated.
 */
export function createBrowserInputPump(
  send: (input: BrowserInputPayload) => Promise<unknown>,
): BrowserInputPump {
  const reliable: BrowserInputPayload[] = [];
  let pendingMove: PointerMove | null = null;
  let pendingWheel: WheelInput | null = null;
  let running: Promise<void> | null = null;
  let disposed = false;

  const takeNext = (): BrowserInputPayload | null => {
    const queued = reliable.shift();
    if (queued) return queued;
    if (pendingWheel) {
      const wheel = pendingWheel;
      pendingWheel = null;
      return wheel;
    }
    if (pendingMove) {
      const move = pendingMove;
      pendingMove = null;
      return move;
    }
    return null;
  };

  const start = (): void => {
    if (disposed || running !== null) return;
    const drain = async (): Promise<void> => {
      for (;;) {
        if (disposed) return;
        const next = takeNext();
        if (!next) return;
        try {
          await send(next);
        } catch {
          // Input failures are surfaced by the command layer. Keep draining so
          // a transient failure cannot leave a mouse button or key stuck.
        }
      }
    };
    running = drain().finally(() => {
      running = null;
      if (!disposed && (reliable.length > 0 || pendingMove || pendingWheel)) start();
    });
  };

  const push = (input: BrowserInputPayload): void => {
    if (disposed) return;
    if (input.kind === "pointer" && input.action === "move") {
      pendingMove = input as PointerMove;
    } else if (input.kind === "wheel") {
      pendingWheel = pendingWheel
        ? {
            ...input,
            deltaX: pendingWheel.deltaX + input.deltaX,
            deltaY: pendingWheel.deltaY + input.deltaY,
          }
        : input;
    } else {
      // A final drag position must be delivered before pointer-up. Moving it
      // into the reliable lane preserves selection and drag semantics.
      if (input.kind === "pointer" && pendingMove) {
        reliable.push(pendingMove);
        pendingMove = null;
      }
      reliable.push(input);
    }
    start();
  };

  return {
    push,
    flush: async () => {
      start();
      for (;;) {
        const current = running;
        if (current === null) return;
        await current;
      }
    },
    dispose: () => {
      disposed = true;
      reliable.length = 0;
      pendingMove = null;
      pendingWheel = null;
    },
  };
}
