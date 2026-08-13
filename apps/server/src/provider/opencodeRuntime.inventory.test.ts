import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OpenCodeRuntime, OpenCodeRuntimeLive } from "./opencodeRuntime.ts";

const testLayer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("loadOpenCodeInventory", (it) => {
  it.effect("rejects malformed model metadata from a configured OpenCode server", () =>
    Effect.gen(function* () {
      const runtime = yield* OpenCodeRuntime;
      const client = {
        provider: {
          list: async () => ({
            data: {
              connected: ["evil"],
              all: [
                {
                  id: "evil",
                  name: "Evil",
                  models: { bad: null },
                },
              ],
            },
          }),
        },
        app: { agents: async () => ({ data: [] }) },
      } as unknown as OpencodeClient;

      const error = yield* runtime.loadOpenCodeInventory(client).pipe(Effect.flip);

      NodeAssert.equal(error.operation, "provider.list");
      NodeAssert.equal(error.detail, "OpenCode provider list contained invalid model metadata.");
    }),
  );

  it.effect("rejects malformed agent metadata from a configured OpenCode server", () =>
    Effect.gen(function* () {
      const runtime = yield* OpenCodeRuntime;
      const client = {
        provider: {
          list: async () => ({
            data: {
              connected: ["openai"],
              all: [
                {
                  id: "openai",
                  name: "OpenAI",
                  models: { "gpt-4o": { id: "gpt-4o", name: "GPT-4o" } },
                },
              ],
            },
          }),
        },
        app: { agents: async () => ({ data: [null] }) },
      } as unknown as OpencodeClient;

      const error = yield* runtime.loadOpenCodeInventory(client).pipe(Effect.flip);

      NodeAssert.equal(error.operation, "app.agents");
      NodeAssert.equal(error.detail, "OpenCode agent list contained invalid metadata.");
    }),
  );
});
