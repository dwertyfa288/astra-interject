import {
  DesktopVoiceBridge,
  FollowUpRequest,
  InterjectSnapshot,
  MicLevelStream,
} from "./contracts";
import { VoiceActivityDetector } from "./voice-activity-detector";

export interface TimerScheduler {
  set(callback: () => void | Promise<void>, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface FollowUpHooks {
  reportError(error: unknown): void;
  trace(message: string): void;
  now(): number;
  onMicrophoneChange(microphoneId: string | null): void;
  onFollowUpSubmitted(): void;
}

const minimumVoicedFramesForSubmit = 6;
const silentProbeTraceMs = 1500;

export class FollowUpController {
  private timerHandle: unknown | null = null;
  private activeRequestId = 0;
  private lastRequestId = 0;
  private pendingArm: FollowUpRequest | null = null;
  private windowOpen = false;
  private micRunning = false;
  private windowOpenedAtMs = 0;
  private silentProbeTraced = false;
  private speechEndSilenceMs = 500;
  private disposed = false;
  private readonly voiceActivity = new VoiceActivityDetector();
  private readonly reportError: (error: unknown) => void;
  private readonly trace: (message: string) => void;
  private readonly now: () => number;
  private readonly onMicrophoneChange: (microphoneId: string | null) => void;
  private readonly onFollowUpSubmitted: () => void;

  constructor(
    private readonly voiceBridge: DesktopVoiceBridge,
    private readonly mic: MicLevelStream,
    private readonly timers: TimerScheduler,
    hooks: Partial<FollowUpHooks> = {},
  ) {
    this.reportError = hooks.reportError ?? (() => undefined);
    this.trace = hooks.trace ?? (() => undefined);
    this.now = hooks.now ?? (() => Date.now());
    this.onMicrophoneChange = hooks.onMicrophoneChange ?? (() => undefined);
    this.onFollowUpSubmitted = hooks.onFollowUpSubmitted ?? (() => undefined);
  }

  async apply(snapshot: InterjectSnapshot): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (!snapshot.enabled) {
      if (this.pendingArm || this.windowOpen) {
        this.trace("closed: plugin disabled");
      }

      this.pendingArm = null;
      await this.stopCapture(true);
      return;
    }

    const armRequest = snapshot.armRequest;

    if (
      armRequest &&
      armRequest.id !== this.lastRequestId &&
      this.pendingArm?.id !== armRequest.id
    ) {
      this.trace(`arm-request #${armRequest.id} (${armRequest.timeoutMs}ms)`);
      this.pendingArm = armRequest;
    }

    const busy =
      snapshot.speechPlaying ||
      snapshot.currentState === "processing" ||
      snapshot.currentState === "speaking";

    if (busy) {
      await this.stopCapture(true);
      return;
    }

    if (this.pendingArm && !this.windowOpen) {
      const request = this.pendingArm;
      this.pendingArm = null;
      await this.openWindow(request.id, request.timeoutMs);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;

    if (this.windowOpen || this.pendingArm) {
      this.trace("closed: controller disposed");
    }

    await this.stopCapture(true);
  }

  observeLevel(level: number): void {
    if (!this.windowOpen) {
      return;
    }

    const nowMs = this.now();

    if (
      !this.silentProbeTraced &&
      nowMs - this.windowOpenedAtMs >= silentProbeTraceMs
    ) {
      this.silentProbeTraced = true;
      this.trace(
        `arm #${this.activeRequestId} probe: no speech yet ` +
          `(${Math.round(nowMs - this.windowOpenedAtMs)}ms after open, ` +
          `level=${level.toFixed(4)})`,
      );
    }

    const activity = this.voiceActivity.observe(level, nowMs);

    if (activity === "silence") {
      return;
    }

    this.scheduleFinish(this.activeRequestId, this.speechEndSilenceMs);
  }

  private async openWindow(requestId: number, timeoutMs: number): Promise<void> {
    if (this.windowOpen) {
      await this.stopCapture(true);
    }

    const prefs = await this.voiceBridge.getVoiceCapturePrefs();
    this.speechEndSilenceMs = prefs.speechEndSilenceMs;
    this.onMicrophoneChange(prefs.microphoneId);

    await this.mic.start((level) => this.observeLevel(level));
    this.micRunning = true;
    this.windowOpen = true;
    this.windowOpenedAtMs = this.now();
    this.silentProbeTraced = false;
    this.activeRequestId = requestId;
    this.lastRequestId = requestId;
    this.voiceActivity.reset(this.windowOpenedAtMs);

    try {
      await this.voiceBridge.setPushToTalk(true, false);
    } catch (error) {
      await this.abandonWindow();
      throw error;
    }

    this.trace(`arm #${requestId} window open (${timeoutMs}ms), recording`);
    this.scheduleFinish(requestId, timeoutMs);
  }

  private async finishCapture(requestId: number): Promise<void> {
    if (!this.windowOpen || this.activeRequestId !== requestId) {
      return;
    }

    const voiced = this.voiceActivity.voicedFrameCount;
    const discard = voiced < minimumVoicedFramesForSubmit;
    const elapsedMs = Math.round(this.now() - this.windowOpenedAtMs);

    this.windowOpen = false;
    this.clearTimer();

    this.trace(
      `arm #${requestId} ${discard ? "discarded" : "submitted"} ` +
        `(voiced=${voiced}, ${elapsedMs}ms after open)`,
    );

    try {
      await this.voiceBridge.setPushToTalk(false, discard);

      if (!discard) {
        this.onFollowUpSubmitted();
      }
    } finally {
      await this.stopMic();
    }
  }

  private async stopCapture(discard: boolean): Promise<void> {
    if (!this.windowOpen) {
      return;
    }

    this.windowOpen = false;
    this.clearTimer();

    this.trace(`arm #${this.activeRequestId} stopped (discard=${discard})`);

    try {
      await this.voiceBridge.setPushToTalk(false, discard);
    } finally {
      await this.stopMic();
    }
  }

  private async abandonWindow(): Promise<void> {
    this.windowOpen = false;
    this.clearTimer();
    await this.stopMic();
  }

  private async stopMic(): Promise<void> {
    if (!this.micRunning) {
      return;
    }

    this.micRunning = false;
    await this.mic.stop();
  }

  private scheduleFinish(requestId: number, delayMs: number): void {
    this.clearTimer();
    this.timerHandle = this.timers.set(() => {
      void this.finishCapture(requestId).catch(this.reportError);
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timerHandle === null) {
      return;
    }

    this.timers.clear(this.timerHandle);
    this.timerHandle = null;
  }
}
