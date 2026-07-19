import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automations (
      automation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      project_id TEXT NOT NULL,
      model_selection_json TEXT,
      schedule_json TEXT NOT NULL,
      target_json TEXT NOT NULL,
      status TEXT NOT NULL,
      stop_reason TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      latest_scheduled_for TEXT NOT NULL,
      coalesced_count INTEGER NOT NULL DEFAULT 0,
      thread_id TEXT,
      message_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY (automation_id) REFERENCES automations(automation_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_due
    ON automations(status, next_run_at)
    WHERE deleted_at IS NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_history
    ON automation_runs(automation_id, created_at DESC)
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_one_running
    ON automation_runs(automation_id)
    WHERE status = 'running'
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_one_queued
    ON automation_runs(automation_id)
    WHERE status = 'queued'
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_actionable
    ON automation_runs(status, created_at)
    WHERE status IN ('queued', 'running')
  `;
});
