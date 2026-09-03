import { describe, expect, it } from "vite-plus/test";

import {
  resolveAgentAwarenessPlatformPresentation,
  supportsSharedSettingsSync,
} from "./SettingsRouteScreen.logic";

describe("supportsSharedSettingsSync", () => {
  it("accepts only connected servers that advertise the shared-settings capability", () => {
    expect(
      supportsSharedSettingsSync({
        connectionPhase: "connected",
        capabilities: { threadAutoSettlement: true },
      }),
    ).toBe(true);
    expect(supportsSharedSettingsSync({ connectionPhase: "connected", capabilities: {} })).toBe(
      false,
    );
    expect(
      supportsSharedSettingsSync({
        connectionPhase: "reconnecting",
        capabilities: { threadAutoSettlement: true },
      }),
    ).toBe(false);
  });
});

describe("resolveAgentAwarenessPlatformPresentation", () => {
  it("explains that agent awareness settings are unavailable on Android", () => {
    expect(resolveAgentAwarenessPlatformPresentation("android")).toEqual({
      supported: false,
      subtitle: "iOS only",
    });
  });

  it("leaves supported iOS settings unchanged", () => {
    expect(resolveAgentAwarenessPlatformPresentation("ios")).toEqual({
      supported: true,
      subtitle: undefined,
    });
  });
});
