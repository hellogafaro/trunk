import { AUTOMATION_WS_METHODS, EnvironmentId, type AutomationSnapshot } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export interface EnvironmentAutomationSnapshot {
  readonly environmentId: EnvironmentId;
  readonly snapshot: AutomationSnapshot;
}

export interface AutomationSnapshotsState {
  readonly snapshots: ReadonlyArray<EnvironmentAutomationSnapshot>;
  readonly isLoading: boolean;
  readonly hasError: boolean;
}

export function isAutomationSnapshotLoading(
  result: AsyncResult.AsyncResult<AutomationSnapshot, unknown>,
): boolean {
  return result.waiting && Option.isNone(AsyncResult.value(result));
}

const KEY_SEPARATOR = "\u001f";
const environmentIdOrder = Order.String as Order.Order<EnvironmentId>;

export function automationEnvironmentKey(environmentIds: ReadonlyArray<EnvironmentId>): string {
  return pipe(environmentIds, Arr.sort(environmentIdOrder), (ids) => ids.join(KEY_SEPARATOR));
}

function parseEnvironmentKey(key: string): ReadonlyArray<EnvironmentId> {
  return key.length === 0
    ? []
    : key.split(KEY_SEPARATOR).map((environmentId) => EnvironmentId.make(environmentId));
}

export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const serialByEnvironment = {
    mode: "serial" as const,
    key: (target: { readonly environmentId: EnvironmentId }) => target.environmentId,
  };
  const snapshot = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:automations:snapshot",
    tag: AUTOMATION_WS_METHODS.subscribe,
  });
  const snapshotsFamily = Atom.family((key: string) =>
    Atom.make((get): AutomationSnapshotsState => {
      const snapshots: EnvironmentAutomationSnapshot[] = [];
      let isLoading = false;
      let hasError = false;
      for (const environmentId of parseEnvironmentKey(key)) {
        const result = get(snapshot({ environmentId, input: {} }));
        hasError ||= result._tag === "Failure";
        const value = Option.getOrNull(AsyncResult.value(result));
        // Subscription atoms may remain in a waiting/refreshing state after yielding a value.
        // Only block the page before the first snapshot so an empty snapshot can render.
        isLoading ||= isAutomationSnapshotLoading(result);
        if (value !== null) {
          snapshots.push({ environmentId, snapshot: value });
        }
      }
      return { snapshots, isLoading, hasError };
    }).pipe(Atom.withLabel(`environment-data:automations:snapshots:${key}`)),
  );

  const command = <
    TTag extends
      | typeof AUTOMATION_WS_METHODS.create
      | typeof AUTOMATION_WS_METHODS.update
      | typeof AUTOMATION_WS_METHODS.setStatus
      | typeof AUTOMATION_WS_METHODS.runNow
      | typeof AUTOMATION_WS_METHODS.delete,
  >(
    tag: TTag,
    label: string,
  ) =>
    createEnvironmentRpcCommand(runtime, {
      label,
      tag,
      scheduler,
      concurrency: serialByEnvironment,
    });

  return {
    snapshot,
    snapshots: (environmentIds: ReadonlyArray<EnvironmentId>) =>
      snapshotsFamily(automationEnvironmentKey(environmentIds)),
    create: command(AUTOMATION_WS_METHODS.create, "environment-data:automations:create"),
    update: command(AUTOMATION_WS_METHODS.update, "environment-data:automations:update"),
    setStatus: command(AUTOMATION_WS_METHODS.setStatus, "environment-data:automations:set-status"),
    runNow: command(AUTOMATION_WS_METHODS.runNow, "environment-data:automations:run-now"),
    delete: command(AUTOMATION_WS_METHODS.delete, "environment-data:automations:delete"),
  };
}
