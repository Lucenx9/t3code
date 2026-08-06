import type { CommandId, IsoDateTime } from "@t3tools/contracts";

export interface PendingThreadModeSync<Value> {
  readonly value: Value;
  readonly commandId: CommandId;
  readonly createdAt: IsoDateTime;
  readonly dispatchSequence: number | null;
}

export function beginThreadModeSync<Value>(
  value: Value,
  commandId: CommandId,
  createdAt: IsoDateTime,
): PendingThreadModeSync<Value> {
  return { value, commandId, createdAt, dispatchSequence: null };
}

export function recordThreadModeDispatch<Value>(
  pending: PendingThreadModeSync<Value> | null,
  commandId: CommandId,
  sequence: number,
): PendingThreadModeSync<Value> | null {
  if (pending === null || pending.commandId !== commandId) {
    return pending;
  }
  return { ...pending, dispatchSequence: sequence };
}

export function failThreadModeSync<Value>(
  pending: PendingThreadModeSync<Value> | null,
  commandId: CommandId,
  retryable: boolean,
): PendingThreadModeSync<Value> | null {
  if (pending === null || pending.commandId !== commandId || retryable) {
    return pending;
  }
  return null;
}

export function acknowledgeThreadModeSync<Value>(
  pending: PendingThreadModeSync<Value> | null,
  appliedSequence: number | null,
): PendingThreadModeSync<Value> | null {
  if (
    pending === null ||
    pending.dispatchSequence === null ||
    appliedSequence === null ||
    appliedSequence < pending.dispatchSequence
  ) {
    return pending;
  }
  return null;
}

export function shouldDispatchThreadModeSync<Value>(
  pending: PendingThreadModeSync<Value> | null,
  connected: boolean,
  inFlight: boolean,
): boolean {
  return pending !== null && pending.dispatchSequence === null && connected && !inFlight;
}
