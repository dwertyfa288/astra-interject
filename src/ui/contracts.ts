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

export interface VoiceCapturePrefs {
  speechEndSilenceMs: number;
  microphoneId: string | null;
}

export interface DesktopVoiceBridge {
  setPushToTalk(active: boolean, discard: boolean): Promise<void>;
  getVoiceCapturePrefs(): Promise<VoiceCapturePrefs>;
}

export interface MicLevelStream {
  start(onLevel: (level: number) => void): Promise<void>;
  stop(): Promise<void>;
}
