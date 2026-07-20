import {
  AutomationId,
  AutomationRun,
  AutomationRunId,
  AutomationSchedule,
  AutomationTarget,
  MessageId,
  ModelSelection,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  AutomationRepository,
  AutomationTurnState,
  PersistedAutomation,
  type AutomationRepositoryShape,
} from "../Services/Automations.ts";

const PersistedAutomationDbRow = PersistedAutomation.mapFields(
  Struct.assign({
    modelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    schedule: Schema.fromJsonString(AutomationSchedule),
    target: Schema.fromJsonString(AutomationTarget),
  }),
);

const RunLimitInput = Schema.Struct({ limit: Schema.Int });
const AutomationRunLimitInput = Schema.Struct({ automationId: AutomationId, limit: Schema.Int });
const TurnStateInput = Schema.Struct({ threadId: ThreadId, messageId: MessageId });
const SchedulerLeaseInput = Schema.Struct({
  ownerId: Schema.String,
  now: Schema.String,
  expiresAt: Schema.String,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: PersistedAutomationDbRow,
    execute: () => sql`
      SELECT
        automation_id AS "id",
        title,
        prompt,
        project_id AS "projectId",
        model_selection_json AS "modelSelection",
        runtime_mode AS "runtimeMode",
        schedule_json AS "schedule",
        target_json AS "target",
        status,
        stop_reason AS "stopReason",
        next_run_at AS "nextRunAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM automations
      ORDER BY created_at ASC, automation_id ASC
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: AutomationId,
    Result: PersistedAutomationDbRow,
    execute: (automationId) => sql`
      SELECT
        automation_id AS "id",
        title,
        prompt,
        project_id AS "projectId",
        model_selection_json AS "modelSelection",
        runtime_mode AS "runtimeMode",
        schedule_json AS "schedule",
        target_json AS "target",
        status,
        stop_reason AS "stopReason",
        next_run_at AS "nextRunAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM automations
      WHERE automation_id = ${automationId}
    `,
  });

  const upsertRow = SqlSchema.void({
    Request: PersistedAutomation,
    execute: (row) => sql`
      INSERT INTO automations (
        automation_id, title, prompt, project_id, model_selection_json, runtime_mode,
        schedule_json, target_json, status, stop_reason, next_run_at,
        created_at, updated_at, deleted_at
      ) VALUES (
        ${row.id}, ${row.title}, ${row.prompt}, ${row.projectId},
        ${row.modelSelection === null ? null : JSON.stringify(row.modelSelection)},
        ${row.runtimeMode}, ${JSON.stringify(row.schedule)}, ${JSON.stringify(row.target)}, ${row.status},
        ${row.stopReason}, ${row.nextRunAt}, ${row.createdAt}, ${row.updatedAt}, ${row.deletedAt}
      )
      ON CONFLICT (automation_id) DO UPDATE SET
        title = excluded.title,
        prompt = excluded.prompt,
        project_id = excluded.project_id,
        model_selection_json = excluded.model_selection_json,
        runtime_mode = excluded.runtime_mode,
        schedule_json = excluded.schedule_json,
        target_json = excluded.target_json,
        status = excluded.status,
        stop_reason = excluded.stop_reason,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `,
  });

  const softDeleteRow = SqlSchema.void({
    Request: Schema.Struct({ automationId: AutomationId, deletedAt: Schema.String }),
    execute: ({ automationId, deletedAt }) => sql`
      UPDATE automations
      SET status = 'stopped', stop_reason = 'manual', next_run_at = NULL,
          updated_at = ${deletedAt}, deleted_at = ${deletedAt}
      WHERE automation_id = ${automationId}
    `,
  });

  const runColumns = sql`
    run_id AS "id",
    automation_id AS "automationId",
    trigger,
    status,
    scheduled_for AS "scheduledFor",
    latest_scheduled_for AS "latestScheduledFor",
    coalesced_count AS "coalescedCount",
    thread_id AS "threadId",
    message_id AS "messageId",
    error,
    created_at AS "createdAt",
    started_at AS "startedAt",
    finished_at AS "finishedAt"
  `;

  const listRunRows = SqlSchema.findAll({
    Request: RunLimitInput,
    Result: AutomationRun,
    execute: ({ limit }) => sql`
      SELECT ${runColumns}
      FROM automation_runs
      ORDER BY created_at DESC, run_id DESC
      LIMIT ${limit}
    `,
  });

  const listAutomationRunRows = SqlSchema.findAll({
    Request: AutomationRunLimitInput,
    Result: AutomationRun,
    execute: ({ automationId, limit }) => sql`
      SELECT ${runColumns}
      FROM automation_runs
      WHERE automation_id = ${automationId}
      ORDER BY created_at DESC, run_id DESC
      LIMIT ${limit}
    `,
  });

  const listActionableRunRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: AutomationRun,
    execute: () => sql`
      SELECT ${runColumns}
      FROM automation_runs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at ASC, run_id ASC
    `,
  });

  const getRunRow = SqlSchema.findOneOption({
    Request: AutomationRunId,
    Result: AutomationRun,
    execute: (runId) => sql`
      SELECT ${runColumns}
      FROM automation_runs
      WHERE run_id = ${runId}
    `,
  });

  const upsertRunRow = SqlSchema.void({
    Request: AutomationRun,
    execute: (row) => sql`
      INSERT INTO automation_runs (
        run_id, automation_id, trigger, status, scheduled_for,
        latest_scheduled_for, coalesced_count, thread_id, message_id,
        error, created_at, started_at, finished_at
      ) VALUES (
        ${row.id}, ${row.automationId}, ${row.trigger}, ${row.status}, ${row.scheduledFor},
        ${row.latestScheduledFor}, ${row.coalescedCount}, ${row.threadId}, ${row.messageId},
        ${row.error}, ${row.createdAt}, ${row.startedAt}, ${row.finishedAt}
      )
      ON CONFLICT (run_id) DO UPDATE SET
        status = excluded.status,
        latest_scheduled_for = excluded.latest_scheduled_for,
        coalesced_count = excluded.coalesced_count,
        thread_id = excluded.thread_id,
        message_id = excluded.message_id,
        error = excluded.error,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at
    `,
  });

  const getTurnStateRow = SqlSchema.findOneOption({
    Request: TurnStateInput,
    Result: AutomationTurnState,
    execute: ({ threadId, messageId }) => sql`
      SELECT state, started_at AS "startedAt", completed_at AS "completedAt"
      FROM projection_turns
      WHERE thread_id = ${threadId} AND pending_message_id = ${messageId}
      ORDER BY row_id DESC
      LIMIT 1
    `,
  });

  const acquireLease = SqlSchema.findOne({
    Request: SchedulerLeaseInput,
    Result: Schema.Struct({ ownerId: Schema.String }),
    execute: ({ ownerId, now, expiresAt }) =>
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
          INSERT INTO automation_scheduler_leases (lease_name, owner_id, expires_at, updated_at)
          VALUES ('scheduler', ${ownerId}, ${expiresAt}, ${now})
          ON CONFLICT (lease_name) DO UPDATE SET
            owner_id = excluded.owner_id,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
          WHERE automation_scheduler_leases.owner_id = excluded.owner_id
             OR automation_scheduler_leases.expires_at <= excluded.updated_at
        `;
          return yield* sql`
          SELECT owner_id AS "ownerId"
          FROM automation_scheduler_leases
          WHERE lease_name = 'scheduler'
        `;
        }),
      ),
  });

  const mapError = (operation: string) =>
    Effect.mapError(toPersistenceSqlError(`AutomationRepository.${operation}:query`));

  return AutomationRepository.of({
    list: () => listRows(undefined).pipe(mapError("list")),
    getById: (automationId) => getRow(automationId).pipe(mapError("getById")),
    upsert: (automation) => upsertRow(automation).pipe(mapError("upsert")),
    softDelete: (automationId, deletedAt) =>
      softDeleteRow({ automationId, deletedAt }).pipe(mapError("softDelete")),
    listRuns: (limit) => listRunRows({ limit }).pipe(mapError("listRuns")),
    listActionableRuns: () => listActionableRunRows(undefined).pipe(mapError("listActionableRuns")),
    listRunsByAutomation: (automationId, limit) =>
      listAutomationRunRows({ automationId, limit }).pipe(mapError("listRunsByAutomation")),
    getRunById: (runId) => getRunRow(runId).pipe(mapError("getRunById")),
    upsertRun: (run) => upsertRunRow(run).pipe(mapError("upsertRun")),
    enqueueRun: ({ run, automation }) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const queuedRuns = yield* listAutomationRunRows({
              automationId: run.automationId,
              limit: 10,
            });
            const queued = queuedRuns.find((candidate) => candidate.status === "queued");
            const result =
              queued === undefined
                ? run
                : {
                    ...queued,
                    latestScheduledFor: run.latestScheduledFor,
                    coalescedCount: queued.coalescedCount + 1,
                  };
            yield* upsertRunRow(result);
            if (automation !== null) yield* upsertRow(automation);
            return result;
          }),
        )
        .pipe(mapError("enqueueRun")),
    stopAndCancelQueued: ({ automation, finishedAt, error }) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* upsertRow(automation);
            yield* sql`
            UPDATE automation_runs
            SET status = 'cancelled', error = ${error}, finished_at = ${finishedAt}
            WHERE automation_id = ${automation.id} AND status = 'queued'
          `;
          }),
        )
        .pipe(mapError("stopAndCancelQueued")),
    deleteAndCancelActionable: ({ automationId, deletedAt }) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* softDeleteRow({ automationId, deletedAt });
            yield* sql`
            UPDATE automation_runs
            SET status = 'cancelled', error = 'Automation deleted.', finished_at = ${deletedAt}
            WHERE automation_id = ${automationId} AND status IN ('queued', 'running')
          `;
          }),
        )
        .pipe(mapError("deleteAndCancelActionable")),
    acquireSchedulerLease: (input) =>
      acquireLease(input).pipe(
        Effect.map((lease) => lease.ownerId === input.ownerId),
        mapError("acquireSchedulerLease"),
      ),
    getTurnState: (input) => getTurnStateRow(input).pipe(mapError("getTurnState")),
  } satisfies AutomationRepositoryShape);
});

export const AutomationRepositoryLive = Layer.effect(AutomationRepository, make);
