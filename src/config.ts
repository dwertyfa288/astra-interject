export interface InterjectConfig {
  enabled: boolean;
  followUpTimeoutSeconds: number;
  followUpOnce: boolean;
}

export const DEFAULT_CONFIG: InterjectConfig = {
  enabled: true,
  followUpTimeoutSeconds: 8,
  followUpOnce: false,
};

export function normalizeConfig(value: unknown): InterjectConfig {
  const config = isRecord(value) ? value : {};
  const timeoutSeconds = config.follow_up_timeout_seconds;

  return {
    enabled:
      typeof config.enabled === "boolean"
        ? config.enabled
        : DEFAULT_CONFIG.enabled,
    followUpTimeoutSeconds:
      typeof timeoutSeconds === "number" &&
      Number.isInteger(timeoutSeconds) &&
      timeoutSeconds >= 2 &&
      timeoutSeconds <= 30
        ? timeoutSeconds
        : DEFAULT_CONFIG.followUpTimeoutSeconds,
    followUpOnce:
      typeof config.follow_up_once === "boolean"
        ? config.follow_up_once
        : DEFAULT_CONFIG.followUpOnce,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
