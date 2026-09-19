import { InterjectSnapshot } from "./contracts";
import { createDesktopVoiceBridge } from "./desktop-bridge";
import { FollowUpController, TimerScheduler } from "./follow-up-controller";
import { createMicLevelStream } from "./mic-level-source";

interface AstraPluginBridge {
  callBackend(method: string, params: Record<string, unknown>): Promise<unknown>;
}

interface AstraWindow extends Window {
  __astraInterjectActive?: boolean;
  __astraPluginBridge?: Record<string, AstraPluginBridge>;
  __astraPluginCleanup?: Record<string, () => void>;
}

const pluginId = "astra-interject";
const astraWindow = window as AstraWindow;

function start(): void {
  astraWindow.__astraInterjectActive = true;

  const pluginBridge = astraWindow.__astraPluginBridge?.[pluginId];

  if (!pluginBridge) {
    delete astraWindow.__astraInterjectActive;
    return;
  }

  let polling = false;
  let lastError = "";
  let cleanedUp = false;
  let microphoneId: string | null = null;
  const reportError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);

    if (!message || message === lastError) {
      return;
    }

    lastError = message;
    void pluginBridge.callBackend("reportError", { message }).catch(() => undefined);
  };

  const trace = (message: string): void => {
    void pluginBridge.callBackend("trace", { message }).catch(() => undefined);
  };

  let controller: FollowUpController;

  try {
    const desktopVoiceBridge = createDesktopVoiceBridge(astraWindow);
    const mic = createMicLevelStream(() => microphoneId);
    controller = new FollowUpController(desktopVoiceBridge, mic, browserTimers, {
      reportError,
      trace,
      onMicrophoneChange: (id) => {
        microphoneId = id;
      },
      onFollowUpSubmitted: () => {
        void pluginBridge
          .callBackend("followUpSent", {})
          .catch(() => undefined);
      },
    });
  } catch (error) {
    reportError(error);
    delete astraWindow.__astraInterjectActive;
    return;
  }

  const poll = async (): Promise<void> => {
    if (polling) {
      return;
    }

    polling = true;

    try {
      const value = await pluginBridge.callBackend("poll", {});
      const snapshot = readSnapshot(value);

      if (snapshot) {
        await controller.apply(snapshot);
        lastError = "";
      }
    } catch (error) {
      reportError(error);
    } finally {
      polling = false;
    }
  };

  const pollingInterval = window.setInterval(() => void poll(), 150);
  void poll();

  if (astraWindow.__astraPluginCleanup) {
    astraWindow.__astraPluginCleanup[pluginId] = () => {
      cleanedUp = true;
      window.clearInterval(pollingInterval);
      void controller.dispose().catch(reportError);
      delete astraWindow.__astraInterjectActive;
    };
  }
}

const browserTimers: TimerScheduler = {
  set(callback, delayMs) {
    return window.setTimeout(() => void callback(), delayMs);
  },
  clear(handle) {
    window.clearTimeout(handle as number);
  },
};

if (!astraWindow.__astraInterjectActive) {
  start();
}

function readSnapshot(value: unknown): InterjectSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.enabled !== "boolean" ||
    typeof value.currentState !== "string" ||
    typeof value.speechPlaying !== "boolean"
  ) {
    return null;
  }

  const armRequest = value.armRequest;

  if (armRequest === null) {
    return {
      enabled: value.enabled,
      currentState: value.currentState,
      speechPlaying: value.speechPlaying,
      armRequest: null,
    };
  }

  if (
    !isRecord(armRequest) ||
    typeof armRequest.id !== "number" ||
    typeof armRequest.timeoutMs !== "number"
  ) {
    return null;
  }

  return {
    enabled: value.enabled,
    currentState: value.currentState,
    speechPlaying: value.speechPlaying,
    armRequest: {
      id: armRequest.id,
      timeoutMs: armRequest.timeoutMs,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
