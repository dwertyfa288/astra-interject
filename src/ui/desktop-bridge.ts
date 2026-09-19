import { DesktopVoiceBridge, VoiceCapturePrefs } from "./contracts";

type HostInvoke = (
  command: string,
  argumentsValue: Record<string, unknown>,
) => Promise<unknown>;

const defaultPrefs: VoiceCapturePrefs = {
  speechEndSilenceMs: 500,
  microphoneId: null,
};

export function createDesktopVoiceBridge(host: unknown): DesktopVoiceBridge {
  const invoke = resolveInvoke(host);

  return {
    async setPushToTalk(active: boolean, discard: boolean): Promise<void> {
      await invoke("set_push_to_talk", { active, discard });
    },
    async getVoiceCapturePrefs(): Promise<VoiceCapturePrefs> {
      const settings = await invoke("get_settings", {});
      return readVoiceCapturePrefs(settings);
    },
  };
}

function readVoiceCapturePrefs(value: unknown): VoiceCapturePrefs {
  if (!isRecord(value) || !isRecord(value.voice)) {
    return { ...defaultPrefs };
  }

  const voice = value.voice;
  const silenceDuration = voice.silence_duration_ms;
  const microphoneId = voice.microphone_id;

  return {
    speechEndSilenceMs:
      typeof silenceDuration === "number" && Number.isFinite(silenceDuration)
        ? Math.min(3000, Math.max(250, Math.round(silenceDuration)))
        : defaultPrefs.speechEndSilenceMs,
    microphoneId:
      typeof microphoneId === "string" && microphoneId.trim()
        ? microphoneId.trim()
        : null,
  };
}

function resolveInvoke(host: unknown): HostInvoke {
  if (!isRecord(host)) {
    throw new Error("Astra desktop bridge is unavailable");
  }

  const tauriInternals = host.__TAURI_INTERNALS__;
  const tauriInvoke = readBoundInvoke(tauriInternals);

  if (tauriInvoke) {
    return tauriInvoke;
  }

  const electronBridge = host.electronBridge;
  const electronInvoke = readBoundInvoke(electronBridge);

  if (electronInvoke) {
    return electronInvoke;
  }

  throw new Error("Astra desktop bridge is unavailable");
}

function readBoundInvoke(owner: unknown): HostInvoke | null {
  if (!isRecord(owner) || typeof owner.invoke !== "function") {
    return null;
  }

  return (command, argumentsValue) =>
    Reflect.apply(owner.invoke as (...args: unknown[]) => Promise<unknown>, owner, [
      command,
      argumentsValue,
    ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
