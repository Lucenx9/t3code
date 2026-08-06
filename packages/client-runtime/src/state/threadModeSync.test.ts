import { describe, expect, it } from "@effect/vitest";
import { CommandId } from "@t3tools/contracts";

import {
  acknowledgeThreadModeSync,
  beginThreadModeSync,
  failThreadModeSync,
  recordThreadModeDispatch,
  shouldDispatchThreadModeSync,
} from "./threadModeSync.ts";

const commandId = (value: string) => CommandId.make(value);

describe("thread mode sync", () => {
  it("keeps the latest A -> B -> A override until its own sequence is applied", () => {
    const first = beginThreadModeSync("approval-required", commandId("command-1"), "created-1");
    const latest = beginThreadModeSync("full-access", commandId("command-2"), "created-2");

    expect(recordThreadModeDispatch(latest, first.commandId, 10)).toBe(latest);

    const dispatched = recordThreadModeDispatch(latest, latest.commandId, 12);
    expect(acknowledgeThreadModeSync(dispatched, 11)).toBe(dispatched);
    expect(acknowledgeThreadModeSync(dispatched, 12)).toBeNull();
  });

  it("clears an override when a later coalesced shell sequence is applied", () => {
    const pending = recordThreadModeDispatch(
      beginThreadModeSync("approval-required", commandId("command-1"), "created-1"),
      commandId("command-1"),
      10,
    );

    expect(acknowledgeThreadModeSync(pending, 11)).toBeNull();
  });

  it("retains retryable failures and accepts a same-command retry", () => {
    const pending = beginThreadModeSync("approval-required", commandId("command-1"), "created-1");

    expect(failThreadModeSync(pending, pending.commandId, true)).toBe(pending);
    expect(shouldDispatchThreadModeSync(pending, false, false)).toBe(false);
    expect(shouldDispatchThreadModeSync(pending, true, true)).toBe(false);
    expect(shouldDispatchThreadModeSync(pending, true, false)).toBe(true);
    expect(recordThreadModeDispatch(pending, pending.commandId, 10)).toEqual({
      ...pending,
      dispatchSequence: 10,
    });
  });

  it("does not dispatch again after the command sequence is known", () => {
    const pending = recordThreadModeDispatch(
      beginThreadModeSync("approval-required", commandId("command-1"), "created-1"),
      commandId("command-1"),
      10,
    );

    expect(shouldDispatchThreadModeSync(pending, true, false)).toBe(false);
  });

  it("ignores stale failures and clears a matching terminal failure", () => {
    const pending = beginThreadModeSync("approval-required", commandId("command-2"), "created-2");

    expect(failThreadModeSync(pending, commandId("command-1"), false)).toBe(pending);
    expect(failThreadModeSync(pending, pending.commandId, false)).toBeNull();
  });
});
