import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE automations
    SET runtime_mode = 'full-access'
    WHERE runtime_mode <> 'full-access'
  `;
});
