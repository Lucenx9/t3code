import { describe, expect, it, vi } from "vite-plus/test";

import {
  createAppUpdateLaunchCheck,
  registerHiddenUpdateTap,
  runAppUpdateCheck,
  type AppUpdateCheckState,
  type AppUpdateClient,
} from "./app-updates";

vi.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: vi.fn(),
  fetchUpdateAsync: vi.fn(),
  reloadAsync: vi.fn(),
}));

function makeUpdateClient(overrides: Partial<AppUpdateClient> = {}): AppUpdateClient {
  return {
    isEnabled: true,
    checkForUpdateAsync: vi.fn(async () => ({
      isAvailable: false,
      isRollBackToEmbedded: false,
    })),
    fetchUpdateAsync: vi.fn(async () => ({
      isNew: true,
      isRollBackToEmbedded: false,
    })),
    reloadAsync: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runAppUpdateCheck", () => {
  it("downloads and restarts when a new update is available", async () => {
    const client = makeUpdateClient({
      checkForUpdateAsync: vi.fn(async () => ({
        isAvailable: true,
        isRollBackToEmbedded: false,
      })),
    });
    const states: AppUpdateCheckState[] = [];

    await runAppUpdateCheck({ client, onStateChange: (state) => states.push(state) });

    expect(client.checkForUpdateAsync).toHaveBeenCalledOnce();
    expect(client.fetchUpdateAsync).toHaveBeenCalledOnce();
    expect(client.reloadAsync).toHaveBeenCalledOnce();
    expect(states).toEqual(["checking", "downloading", "restarting"]);
  });

  it("restarts into the embedded bundle for a rollback directive", async () => {
    const client = makeUpdateClient({
      checkForUpdateAsync: vi.fn(async () => ({
        isAvailable: false,
        isRollBackToEmbedded: true,
      })),
      fetchUpdateAsync: vi.fn(async () => ({
        isNew: false,
        isRollBackToEmbedded: true,
      })),
    });

    await runAppUpdateCheck({ client });

    expect(client.fetchUpdateAsync).toHaveBeenCalledOnce();
    expect(client.reloadAsync).toHaveBeenCalledOnce();
  });

  it("stops quietly when the running bundle is current", async () => {
    const client = makeUpdateClient();
    const states: AppUpdateCheckState[] = [];

    await runAppUpdateCheck({ client, onStateChange: (state) => states.push(state) });

    expect(client.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(client.reloadAsync).not.toHaveBeenCalled();
    expect(states).toEqual(["checking", "current"]);
  });

  it("reports manual failures without continuing the update", async () => {
    const reportError = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeUpdateClient({
      checkForUpdateAsync: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const failures: string[] = [];
    const states: AppUpdateCheckState[] = [];

    await runAppUpdateCheck({
      client,
      onFailure: (message) => failures.push(message),
      onStateChange: (state) => states.push(state),
    });

    expect(client.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(failures).toEqual(["offline"]);
    expect(states).toEqual(["checking", "idle"]);
    reportError.mockRestore();
  });
});

describe("createAppUpdateLaunchCheck", () => {
  it("checks at most once for each JavaScript launch", async () => {
    const client = makeUpdateClient();
    const checkOnLaunch = createAppUpdateLaunchCheck(client);

    const first = checkOnLaunch();
    const second = checkOnLaunch();
    await first;

    expect(second).toBeUndefined();
    expect(client.checkForUpdateAsync).toHaveBeenCalledOnce();
  });

  it("does nothing when Expo updates are disabled", () => {
    const client = makeUpdateClient({ isEnabled: false });
    const checkOnLaunch = createAppUpdateLaunchCheck(client);

    expect(checkOnLaunch()).toBeUndefined();
    expect(client.checkForUpdateAsync).not.toHaveBeenCalled();
  });
});

describe("registerHiddenUpdateTap", () => {
  it("unlocks the manual check on the fifth tap", () => {
    let count = 0;

    for (let tap = 1; tap <= 5; tap += 1) {
      const result = registerHiddenUpdateTap(count);
      expect(result.shouldCheck).toBe(tap === 5);
      count = result.nextCount;
    }

    expect(count).toBe(0);
  });
});
