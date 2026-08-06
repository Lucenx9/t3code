import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  acknowledgeThreadModeSync,
  failThreadModeSync,
  recordThreadModeDispatch,
  shouldDispatchThreadModeSync,
  type PendingThreadModeSync,
} from "@t3tools/client-runtime/state/thread-mode-sync";
import type { CommandId, DispatchResult, EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  composerDraftsAtom,
  ensureComposerDraftsLoaded,
  getComposerDraftSnapshot,
  type ComposerDraft,
  updateComposerDraftSettings,
} from "./use-composer-drafts";
import { environmentSnapshotAtom } from "./shell";
import { shouldRetryThreadOutboxDelivery, threadOutboxRetryDelayMs } from "./thread-outbox-model";
import { threadEnvironment } from "./threads";
import { useAtomCommand } from "./use-atom-command";
import {
  setPendingConnectionError,
  useRemoteConnectionStatus,
} from "./use-remote-environment-registry";

const threadModeSyncShellSequencesAtom = Atom.make((get) => {
  const sequences = new Map<EnvironmentId, number | null>();
  for (const [threadKey, draft] of Object.entries(get(composerDraftsAtom))) {
    if (draft.runtimeModeSync === undefined && draft.interactionModeSync === undefined) {
      continue;
    }
    const threadRef = parseScopedThreadKey(threadKey);
    if (threadRef === null || sequences.has(threadRef.environmentId)) {
      continue;
    }
    const snapshot = get(environmentSnapshotAtom(threadRef.environmentId));
    sequences.set(threadRef.environmentId, snapshot?.snapshotSequence ?? null);
  }
  return sequences;
}).pipe(Atom.withLabel("mobile:thread-mode-sync:shell-sequences"));

export function useThreadModeSyncDrain(): void {
  const setThreadRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const drafts = useAtomValue(composerDraftsAtom);
  const shellSequences = useAtomValue(threadModeSyncShellSequencesAtom);
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const [retryTick, setRetryTick] = useState(0);
  const inFlightCommandIdsRef = useRef(new Set<CommandId>());
  const retryAttemptRef = useRef(new Map<CommandId, number>());
  const retryTimersRef = useRef(new Map<CommandId, ReturnType<typeof setTimeout>>());
  const clearRetry = useCallback((commandId: CommandId) => {
    retryAttemptRef.current.delete(commandId);
    const timer = retryTimersRef.current.get(commandId);
    if (timer !== undefined) {
      clearTimeout(timer);
      retryTimersRef.current.delete(commandId);
    }
  }, []);
  const scheduleRetry = useCallback((commandId: CommandId) => {
    const attempt = (retryAttemptRef.current.get(commandId) ?? 0) + 1;
    retryAttemptRef.current.set(commandId, attempt);
    const existingTimer = retryTimersRef.current.get(commandId);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      retryTimersRef.current.delete(commandId);
      setRetryTick((current) => current + 1);
    }, threadOutboxRetryDelayMs(attempt));
    retryTimersRef.current.set(commandId, timer);
  }, []);

  useEffect(() => {
    ensureComposerDraftsLoaded();
    return () => {
      for (const timer of retryTimersRef.current.values()) {
        clearTimeout(timer);
      }
      retryTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const connectedEnvironmentIds = new Set<EnvironmentId>();
    for (const environment of connectedEnvironments) {
      if (environment.connectionState === "connected") {
        connectedEnvironmentIds.add(environment.environmentId);
      }
    }
    const reportTerminalFailure = (error: unknown, fallback: string) => {
      setPendingConnectionError(error instanceof Error ? error.message : fallback);
    };
    const dispatchModeSync = <Value, Failure>(input: {
      readonly threadKey: string;
      readonly pending: PendingThreadModeSync<Value>;
      readonly dispatch: () => Promise<AtomCommandResult<DispatchResult, Failure>>;
      readonly readPending: (draft: ComposerDraft) => PendingThreadModeSync<Value> | undefined;
      readonly clearPending: () => void;
      readonly writePending: (pending: PendingThreadModeSync<Value> | null) => void;
      readonly failureMessage: string;
    }) => {
      const { commandId } = input.pending;
      inFlightCommandIdsRef.current.add(commandId);
      void input
        .dispatch()
        .then((result) => {
          const currentPending =
            input.readPending(getComposerDraftSnapshot(input.threadKey)) ?? null;
          if (AsyncResult.isFailure(result)) {
            const error = Cause.squash(result.cause);
            const retryable =
              isAtomCommandInterrupted(result) || shouldRetryThreadOutboxDelivery(error);
            const next = failThreadModeSync(currentPending, commandId, retryable);
            if (next !== currentPending) {
              input.clearPending();
              clearRetry(commandId);
              reportTerminalFailure(error, input.failureMessage);
            } else if (currentPending?.commandId === commandId) {
              scheduleRetry(commandId);
            } else {
              clearRetry(commandId);
            }
            return;
          }
          const next = recordThreadModeDispatch(currentPending, commandId, result.value.sequence);
          if (next !== currentPending) {
            input.writePending(next);
          }
          clearRetry(commandId);
        })
        .finally(() => {
          inFlightCommandIdsRef.current.delete(commandId);
        });
    };

    for (const [threadKey, draft] of Object.entries(drafts)) {
      const threadRef = parseScopedThreadKey(threadKey);
      if (threadRef === null) {
        continue;
      }

      const appliedSequence = shellSequences.get(threadRef.environmentId) ?? null;
      const runtimeModeSync = draft.runtimeModeSync ?? null;
      const interactionModeSync = draft.interactionModeSync ?? null;
      const runtimeAcknowledged =
        runtimeModeSync !== null &&
        acknowledgeThreadModeSync(runtimeModeSync, appliedSequence) === null;
      const interactionAcknowledged =
        interactionModeSync !== null &&
        acknowledgeThreadModeSync(interactionModeSync, appliedSequence) === null;
      if (runtimeAcknowledged || interactionAcknowledged) {
        updateComposerDraftSettings(threadKey, {
          ...(runtimeAcknowledged ? { runtimeMode: undefined, runtimeModeSync: undefined } : {}),
          ...(interactionAcknowledged
            ? { interactionMode: undefined, interactionModeSync: undefined }
            : {}),
        });
        if (runtimeAcknowledged && runtimeModeSync !== null) {
          clearRetry(runtimeModeSync.commandId);
        }
        if (interactionAcknowledged && interactionModeSync !== null) {
          clearRetry(interactionModeSync.commandId);
        }
        continue;
      }

      const environmentConnected = connectedEnvironmentIds.has(threadRef.environmentId);

      if (
        runtimeModeSync !== null &&
        shouldDispatchThreadModeSync(
          runtimeModeSync,
          environmentConnected,
          inFlightCommandIdsRef.current.has(runtimeModeSync.commandId),
        )
      ) {
        dispatchModeSync({
          threadKey,
          pending: runtimeModeSync,
          dispatch: () =>
            setThreadRuntimeMode({
              environmentId: threadRef.environmentId,
              input: {
                threadId: threadRef.threadId,
                runtimeMode: runtimeModeSync.value,
                commandId: runtimeModeSync.commandId,
                createdAt: runtimeModeSync.createdAt,
              },
            }),
          readPending: (current) => current.runtimeModeSync,
          clearPending: () =>
            updateComposerDraftSettings(threadKey, {
              runtimeMode: undefined,
              runtimeModeSync: undefined,
            }),
          writePending: (next) =>
            updateComposerDraftSettings(threadKey, { runtimeModeSync: next ?? undefined }),
          failureMessage: "Failed to change access mode.",
        });
      }

      if (
        interactionModeSync !== null &&
        shouldDispatchThreadModeSync(
          interactionModeSync,
          environmentConnected,
          inFlightCommandIdsRef.current.has(interactionModeSync.commandId),
        )
      ) {
        dispatchModeSync({
          threadKey,
          pending: interactionModeSync,
          dispatch: () =>
            setThreadInteractionMode({
              environmentId: threadRef.environmentId,
              input: {
                threadId: threadRef.threadId,
                interactionMode: interactionModeSync.value,
                commandId: interactionModeSync.commandId,
                createdAt: interactionModeSync.createdAt,
              },
            }),
          readPending: (current) => current.interactionModeSync,
          clearPending: () =>
            updateComposerDraftSettings(threadKey, {
              interactionMode: undefined,
              interactionModeSync: undefined,
            }),
          writePending: (next) =>
            updateComposerDraftSettings(threadKey, {
              interactionModeSync: next ?? undefined,
            }),
          failureMessage: "Failed to change interaction mode.",
        });
      }
    }
  }, [
    clearRetry,
    connectedEnvironments,
    drafts,
    retryTick,
    scheduleRetry,
    setThreadInteractionMode,
    setThreadRuntimeMode,
    shellSequences,
  ]);
}
