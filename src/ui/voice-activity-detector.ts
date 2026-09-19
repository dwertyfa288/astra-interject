export type VoiceActivity = "silence" | "started" | "active";

const speechHoldMs = 500;
const onsetFramesRequired = 2;

export class VoiceActivityDetector {
  private noiseFloor = 0.0005;
  private consecutiveVoiceFrames = 0;
  private speaking = false;
  private voicedFrames = 0;
  private openedAtMs = 0;

  reset(nowMs: number): void {
    this.noiseFloor = 0.0005;
    this.consecutiveVoiceFrames = 0;
    this.speaking = false;
    this.voicedFrames = 0;
    this.openedAtMs = nowMs;
  }

  get voicedFrameCount(): number {
    return this.voicedFrames;
  }

  observe(level: number, nowMs: number): VoiceActivity {
    if (!Number.isFinite(level) || level < 0) {
      return "silence";
    }

    const onsetThreshold = Math.max(0.012, this.noiseFloor * 4);

    if (this.speaking) {
      const sustainThreshold = Math.max(0.006, this.noiseFloor * 2.5);

      if (level >= sustainThreshold) {
        this.voicedFrames += 1;
        return "active";
      }

      return "silence";
    }

    if (nowMs - this.openedAtMs < speechHoldMs) {
      this.consecutiveVoiceFrames = 0;
      this.adaptNoiseFloor(level);
      return "silence";
    }

    if (level >= onsetThreshold) {
      this.consecutiveVoiceFrames += 1;

      if (this.consecutiveVoiceFrames >= onsetFramesRequired) {
        this.speaking = true;
        this.voicedFrames = this.consecutiveVoiceFrames;
        return "started";
      }

      return "silence";
    }

    this.consecutiveVoiceFrames = 0;
    this.adaptNoiseFloor(level);
    return "silence";
  }

  private adaptNoiseFloor(level: number): void {
    this.noiseFloor = Math.min(0.02, this.noiseFloor * 0.95 + level * 0.05);
  }
}
