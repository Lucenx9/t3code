import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

export function supportsSharedSettingsSync(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly capabilities: Pick<ExecutionEnvironmentCapabilities, "threadAutoSettlement"> | null;
}): boolean {
  return input.connectionPhase === "connected" && input.capabilities?.threadAutoSettlement === true;
}

export function resolveAgentAwarenessPlatformPresentation(platform: string): {
  readonly supported: boolean;
  readonly subtitle: string | undefined;
} {
  return platform === "ios"
    ? { supported: true, subtitle: undefined }
    : { supported: false, subtitle: "iOS only" };
}
