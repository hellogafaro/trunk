import {
  Automation,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  IsoDateTime,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import type { AutomationRepositoryError } from "../Errors.ts";

export const PersistedAutomation = Automation.mapFields(
  Struct.assign({ deletedAt: Schema.NullOr(IsoDateTime) }),
);
export type PersistedAutomation = typeof PersistedAutomation.Type;

export const AutomationTurnState = Schema.Struct({
  state: Schema.Literals(["pending", "running", "interrupted", "completed", "error"]),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type AutomationTurnState = typeof AutomationTurnState.Type;

export interface AutomationRepositoryShape {
  readonly list: () => Effect.Effect<ReadonlyArray<PersistedAutomation>, AutomationRepositoryError>;
  readonly getById: (
    automationId: AutomationId,
  ) => Effect.Effect<Option.Option<PersistedAutomation>, AutomationRepositoryError>;
  readonly upsert: (
    automation: PersistedAutomation,
  ) => Effect.Effect<void, AutomationRepositoryError>;
  readonly softDelete: (
    automationId: AutomationId,
    deletedAt: string,
  ) => Effect.Effect<void, AutomationRepositoryError>;
  readonly listRuns: (
    limit: number,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, AutomationRepositoryError>;
  readonly listActionableRuns: () => Effect.Effect<
    ReadonlyArray<AutomationRun>,
    AutomationRepositoryError
  >;
  readonly listRunsByAutomation: (
    automationId: AutomationId,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<AutomationRun>, AutomationRepositoryError>;
  readonly getRunById: (
    runId: AutomationRunId,
  ) => Effect.Effect<Option.Option<AutomationRun>, AutomationRepositoryError>;
  readonly upsertRun: (run: AutomationRun) => Effect.Effect<void, AutomationRepositoryError>;
  readonly getTurnState: (input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  }) => Effect.Effect<Option.Option<AutomationTurnState>, AutomationRepositoryError>;
}

export class AutomationRepository extends Context.Service<
  AutomationRepository,
  AutomationRepositoryShape
>()("t3/persistence/Services/Automations/AutomationRepository") {}
