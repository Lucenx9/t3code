import * as Updates from "expo-updates";

import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  reportAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

export type AppUpdateCheckState = "idle" | "checking" | "downloading" | "restarting" | "current";

export interface AppUpdateClient {
  readonly isEnabled: boolean;
  readonly checkForUpdateAsync: () => Promise<{
    readonly isAvailable: boolean;
    readonly isRollBackToEmbedded: boolean;
  }>;
  readonly fetchUpdateAsync: () => Promise<{
    readonly isNew: boolean;
    readonly isRollBackToEmbedded: boolean;
  }>;
  readonly reloadAsync: () => Promise<void>;
}

interface AppUpdateCheckOptions {
  readonly client?: AppUpdateClient;
  readonly onFailure?: (message: string) => void;
  readonly onStateChange?: (state: AppUpdateCheckState) => void;
}

const HIDDEN_UPDATE_TAP_COUNT = 5;

/**
 * Keeps the manual update affordance discoverable only to someone deliberately
 * tapping the version row five times.
 */
export function registerHiddenUpdateTap(count: number): {
  readonly nextCount: number;
  readonly shouldCheck: boolean;
} {
  const nextCount = count + 1;
  if (nextCount >= HIDDEN_UPDATE_TAP_COUNT) {
    return {
      nextCount: 0,
      shouldCheck: true,
    };
  }
  return {
    nextCount,
    shouldCheck: false,
  };
}

export async function runAppUpdateCheck(options: AppUpdateCheckOptions = {}): Promise<void> {
  const client = options.client ?? Updates;
  if (!client.isEnabled) return;

  const setState = options.onStateChange ?? (() => {});

  setState("checking");
  const check = await settlePromise(() => client.checkForUpdateAsync());
  if (check._tag === "Failure") {
    reportUpdateFailure(check, "Could not check for updates.", options.onFailure);
    setState("idle");
    return;
  }
  // A rollback directive (`eas update:rollback`) arrives as isAvailable: false
  // with isRollBackToEmbedded: true. The running OTA still has to be dropped.
  if (!check.value.isAvailable && !check.value.isRollBackToEmbedded) {
    setState("current");
    return;
  }

  setState("downloading");
  const fetched = await settlePromise(() => client.fetchUpdateAsync());
  if (fetched._tag === "Failure") {
    reportUpdateFailure(fetched, "Could not download the update.", options.onFailure);
    setState("idle");
    return;
  }
  // isNew is always false for a rollback, so it cannot be the sole gate.
  if (!fetched.value.isNew && !fetched.value.isRollBackToEmbedded) {
    setState("current");
    return;
  }

  setState("restarting");
  const reloaded = await settlePromise(() => client.reloadAsync());
  if (reloaded._tag === "Failure") {
    reportUpdateFailure(reloaded, "Downloaded, but could not restart the app.", options.onFailure);
    setState("idle");
  }
}

function reportUpdateFailure(
  result: AtomCommandResult<unknown, unknown>,
  fallback: string,
  onFailure: AppUpdateCheckOptions["onFailure"],
): void {
  reportAtomCommandResult(result, { label: "app update check" });
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  onFailure?.(error instanceof Error ? error.message : fallback);
}

export function createAppUpdateLaunchCheck(
  client: AppUpdateClient = Updates,
): () => Promise<void> | undefined {
  let started = false;

  return () => {
    if (started || !client.isEnabled) return undefined;
    started = true;
    return runAppUpdateCheck({ client });
  };
}

export const checkForAppUpdateOnLaunch = createAppUpdateLaunchCheck();
