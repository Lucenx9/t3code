import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("048_ProjectionThreadSearchRevision", (it) => {
  it.effect("adds a zero-based message revision to thread projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 47 });
      yield* runMigrations({ toMigrationInclusive: 48 });

      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
        readonly dflt_value: string | null;
      }>`
        PRAGMA table_info(projection_threads)
      `;
      const revision = columns.find((column) => column.name === "searchable_messages_revision");

      assert.equal(revision?.name, "searchable_messages_revision");
      assert.equal(revision?.notnull, 1);
      assert.equal(revision?.dflt_value, "0");
    }),
  );
});
