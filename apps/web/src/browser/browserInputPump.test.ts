import { describe, expect, it } from "vite-plus/test";

import type { BrowserInputPayload } from "./browserInputPump";
import { createBrowserInputPump } from "./browserInputPump";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("browserInputPump", () => {
  it("keeps only the latest pointer move while a request is in flight", async () => {
    const first = deferred();
    const sent: BrowserInputPayload[] = [];
    const pump = createBrowserInputPump(async (input) => {
      sent.push(input);
      if (sent.length === 1) await first.promise;
    });

    pump.push({ kind: "pointer", action: "move", x: 1, y: 1 });
    pump.push({ kind: "pointer", action: "move", x: 2, y: 2 });
    pump.push({ kind: "pointer", action: "move", x: 3, y: 3 });
    first.resolve();
    await pump.flush();

    expect(sent).toEqual([
      { kind: "pointer", action: "move", x: 1, y: 1 },
      { kind: "pointer", action: "move", x: 3, y: 3 },
    ]);
  });

  it("delivers the final drag position before pointer-up", async () => {
    const first = deferred();
    const sent: BrowserInputPayload[] = [];
    const pump = createBrowserInputPump(async (input) => {
      sent.push(input);
      if (sent.length === 1) await first.promise;
    });

    pump.push({ kind: "pointer", action: "down", x: 10, y: 10, button: "left" });
    pump.push({ kind: "pointer", action: "move", x: 40, y: 20 });
    pump.push({ kind: "pointer", action: "move", x: 80, y: 30 });
    pump.push({ kind: "pointer", action: "up", x: 80, y: 30, button: "left" });
    first.resolve();
    await pump.flush();

    expect(sent.map((input) => (input.kind === "pointer" ? input.action : input.kind))).toEqual([
      "down",
      "move",
      "up",
    ]);
    expect(sent[1]).toMatchObject({ x: 80, y: 30 });
  });

  it("accumulates wheel movement while preserving the latest pointer position", async () => {
    const first = deferred();
    const sent: BrowserInputPayload[] = [];
    const pump = createBrowserInputPump(async (input) => {
      sent.push(input);
      if (sent.length === 1) await first.promise;
    });

    pump.push({ kind: "keyboard", action: "down", key: "Shift" });
    pump.push({ kind: "wheel", x: 10, y: 20, deltaX: 1, deltaY: 12 });
    pump.push({ kind: "wheel", x: 30, y: 40, deltaX: 2, deltaY: 18 });
    first.resolve();
    await pump.flush();

    expect(sent[1]).toEqual({ kind: "wheel", x: 30, y: 40, deltaX: 3, deltaY: 30 });
  });

  it("continues draining after a transient send failure", async () => {
    const sent: BrowserInputPayload[] = [];
    const pump = createBrowserInputPump(async (input) => {
      sent.push(input);
      if (sent.length === 1) throw new Error("disconnected");
    });

    pump.push({ kind: "keyboard", action: "down", key: "a" });
    pump.push({ kind: "keyboard", action: "up", key: "a" });
    await pump.flush();

    expect(sent).toHaveLength(2);
  });
});
