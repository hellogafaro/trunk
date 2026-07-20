import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("035_AutomationEnabledStatus", (it) => {
  it.effect("renames persisted automation states and their reason column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* sql`
        INSERT INTO automations (
          automation_id, title, prompt, project_id, schedule_json, target_json,
          status, stop_reason, created_at, updated_at
        ) VALUES
          (
            'automation:enabled', 'Enabled', 'Run it', 'project:one',
            '{"type":"cron","expression":"0 9 * * *","timeZone":"UTC"}',
            '{"type":"fresh-thread"}', 'active', NULL,
            '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'
          ),
          (
            'automation:disabled', 'Disabled', 'Do not run it', 'project:one',
            '{"type":"cron","expression":"0 9 * * *","timeZone":"UTC"}',
            '{"type":"fresh-thread"}', 'stopped', 'manual',
            '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 35 });

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(automations)`;
      const rows = yield* sql<{
        readonly id: string;
        readonly status: string;
        readonly disableReason: string | null;
      }>`
        SELECT
          automation_id AS "id",
          status,
          disable_reason AS "disableReason"
        FROM automations
        ORDER BY automation_id
      `;

      assert.isTrue(columns.some((column) => column.name === "disable_reason"));
      assert.isFalse(columns.some((column) => column.name === "stop_reason"));
      assert.deepStrictEqual(rows, [
        { id: "automation:disabled", status: "disabled", disableReason: "manual" },
        { id: "automation:enabled", status: "enabled", disableReason: null },
      ]);
    }),
  );
});
