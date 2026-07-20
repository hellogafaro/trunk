import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE automations
    RENAME COLUMN stop_reason TO disable_reason
  `;

  yield* sql`
    UPDATE automations
    SET status = CASE status
      WHEN 'active' THEN 'enabled'
      WHEN 'stopped' THEN 'disabled'
      ELSE status
    END
  `;
});
