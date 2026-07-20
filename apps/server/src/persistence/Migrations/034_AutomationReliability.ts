import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE automations
    ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'approval-required'
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_scheduler_leases (
      lease_name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
