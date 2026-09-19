import { DEFAULT_CONFIG, InterjectConfig, normalizeConfig } from "./config";

export interface StateChangedPayload {
  previous: string;
  current: string;
}

export interface FollowUpRequest {
  id: number;
  timeoutMs: number;
}

export interface InterjectSnapshot {
  enabled: boolean;
  currentState: string;
  speechPlaying: boolean;
  armRequest: FollowUpRequest | null;
}

const armSettleMs = 600;

export type SpeechFinishedResult = "queued" | "suppressed" | "ignored";

export class DialogueState {
  private config: InterjectConfig = { ...DEFAULT_CONFIG };
  private currentState = "unknown";
  private nextRequestId = 1;
  private pendingRequest: FollowUpRequest | null = null;
  private lastTransition = "";
  private turnOpen = false;
  private speechPlaying = false;
  private followUpSent = false;
  private armDueAtMs: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  configure(value: unknown): void {
    this.config = normalizeConfig(value);

    if (!this.config.enabled) {
      this.pendingRequest = null;
      this.armDueAtMs = null;
      this.followUpSent = false;
    }
  }

  transition(payload: StateChangedPayload): void {
    const previous = normalizeState(payload.previous);
    const current = normalizeState(payload.current);
    const transitionKey = `${previous}:${current}`;

    this.currentState = current;

    if (transitionKey === this.lastTransition) {
      return;
    }

    this.lastTransition = transitionKey;

    if (current === "processing" || current === "speaking") {
      this.turnOpen = true;
      this.armDueAtMs = null;
    }

    if (current === "error" || current === "stopped") {
      this.turnOpen = false;
      this.armDueAtMs = null;
    }
  }

  speechStarted(): void {
    this.turnOpen = true;
    this.speechPlaying = true;
    this.armDueAtMs = null;
  }

  reportFollowUpSent(): void {
    this.followUpSent = true;
  }

  speechFinished(): SpeechFinishedResult {
    this.speechPlaying = false;

    if (!this.config.enabled || !this.turnOpen) {
      return "ignored";
    }

    if (this.config.followUpOnce && this.followUpSent) {
      this.followUpSent = false;
      return "suppressed";
    }

    this.armDueAtMs = this.now() + armSettleMs;
    return "queued";
  }

  speechInterrupted(): void {
    this.speechPlaying = false;
    this.armDueAtMs = null;
  }

  poll(): InterjectSnapshot {
    if (
      this.armDueAtMs !== null &&
      this.currentState !== "processing" &&
      this.currentState !== "speaking" &&
      this.now() >= this.armDueAtMs
    ) {
      this.armDueAtMs = null;
      this.turnOpen = false;
      this.followUpSent = false;
      this.pendingRequest = {
        id: this.nextRequestId,
        timeoutMs: this.config.followUpTimeoutSeconds * 1000,
      };
      this.nextRequestId += 1;
    }

    const snapshot: InterjectSnapshot = {
      enabled: this.config.enabled,
      currentState: this.currentState,
      speechPlaying: this.speechPlaying,
      armRequest: this.pendingRequest,
    };

    this.pendingRequest = null;
    return snapshot;
  }
}

function normalizeState(value: string): string {
  return value.trim().toLowerCase().replace(/^core_state_/, "");
}
