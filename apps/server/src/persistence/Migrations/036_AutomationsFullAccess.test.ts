import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_AutomationsFullAccess", (it) => {
  it.effect("upgrades every persisted routine to full access", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* sql`
        INSERT INTO automations (
          automation_id, title, prompt, project_id, runtime_mode, schedule_json, target_json,
          status, created_at, updated_at
        ) VALUES
          (
            'automation:approval', 'Approval', 'Run it', 'project:one', 'approval-required',
            '{"type":"cron","expression":"0 9 * * *","timeZone":"UTC"}',
            '{"type":"fresh-thread"}', 'enabled',
            '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'
          ),
          (
            'automation:edits', 'Edits', 'Run it', 'project:one', 'auto-accept-edits',
            '{"type":"cron","expression":"0 9 * * *","timeZone":"UTC"}',
            '{"type":"fresh-thread"}', 'enabled',
            '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 36 });

      const rows = yield* sql<{ readonly runtimeMode: string }>`
        SELECT runtime_mode AS "runtimeMode"
        FROM automations
        ORDER BY automation_id
      `;

      assert.deepStrictEqual(rows, [
        { runtimeMode: "full-access" },
        { runtimeMode: "full-access" },
      ]);
    }),
  );
});
