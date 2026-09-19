import { plugin, s, UiContrib } from "astra-plugin-sdk";

import { DialogueState, StateChangedPayload } from "./dialogue-state";

export function createPluginApp(
  now: () => number = () => Date.now(),
) {
  const dialogueState = new DialogueState(now);

  return plugin({
    id: "astra-interject",
    configSchema: s.object({
      enabled: s.boolean({ default: true }).optional(),
      follow_up_timeout_seconds: s
        .integer({ default: 8, minimum: 2, maximum: 30 })
        .optional(),
      follow_up_once: s.boolean({ default: false }).optional(),
    }),
    ui: {
      contributions: [
        UiContrib.effect("interject.js", { id: "interject-controller" }),
      ],
      onCall: {
        poll: async () => dialogueState.poll(),
        followUpSent: async () => {
          dialogueState.reportFollowUpSent();
          return { accepted: true };
        },
        trace: async (params, context) => {
          const message = readBoundedMessage(params);

          if (message) {
            await context.info(`interject: ${message}`);
          }

          return { accepted: Boolean(message) };
        },
        reportError: async (params, context) => {
          const message = readBoundedMessage(params);

          if (message) {
            await context.error(message);
          }

          return { accepted: Boolean(message) };
        },
      },
    },
    events: {
      subscribe: ["state_changed", "tts_started", "tts_completed", "tts_interrupted"],
      on: async (eventType, payload, context) => {
        if (eventType === "state_changed") {
          const stateChange = readStatePayload(payload);

          if (stateChange) {
            await context.info(
              `interject: state ${stateChange.previous} -> ${stateChange.current}`,
            );
            dialogueState.transition(stateChange);
          }

          return;
        }

        if (eventType === "tts_started") {
          await context.info("interject: tts started (playback running)");
          dialogueState.speechStarted();
          return;
        }

        if (eventType === "tts_completed") {
          const result = dialogueState.speechFinished();

          await context.info(
            result === "queued"
              ? "interject: tts completed, follow-up pending"
              : result === "suppressed"
                ? "interject: tts completed, one follow-up already used"
                : "interject: tts completed, ignored (no spoken turn awaited)",
          );
          return;
        }

        if (eventType === "tts_interrupted") {
          await context.info("interject: tts interrupted, follow-up cancelled");
          dialogueState.speechInterrupted();
        }
      },
    },
    onStart: async (context) => {
      dialogueState.configure(context.config);
    },
    onConfigChanged: (config) => {
      dialogueState.configure(config);
    },
    healthCheck: () => ({ healthy: true, status: "ready" }),
  });
}

function readStatePayload(value: unknown): StateChangedPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.previous !== "string" || typeof value.current !== "string") {
    return null;
  }

  return { previous: value.previous, current: value.current };
}

function readBoundedMessage(value: unknown): string {
  if (!isRecord(value) || typeof value.message !== "string") {
    return "";
  }

  return value.message.trim().slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
