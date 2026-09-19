import { MicLevelStream } from "./contracts";

const sampleIntervalMs = 25;

export function createMicLevelStream(
  getMicrophoneId: () => string | null,
): MicLevelStream {
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let sampler: number | null = null;

  const stop = async (): Promise<void> => {
    if (sampler !== null) {
      window.clearInterval(sampler);
      sampler = null;
    }

    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }

      mediaStream = null;
    }

    if (audioContext) {
      await audioContext.close().catch(() => undefined);
      audioContext = null;
    }
  };

  const start = async (onLevel: (level: number) => void): Promise<void> => {
    await stop();

    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    const microphoneId = getMicrophoneId();

    if (microphoneId) {
      audio.deviceId = { exact: microphoneId };
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio });

    const context = new AudioContext();
    audioContext = context;

    if (context.state === "suspended") {
      await context.resume();
    }

    const source = context.createMediaStreamSource(mediaStream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    sampler = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      onLevel(rms(samples));
    }, sampleIntervalMs);
  };

  return { start, stop };
}

function rms(samples: Float32Array): number {
  let sumSquares = 0;

  for (let index = 0; index < samples.length; index += 1) {
    sumSquares += samples[index] * samples[index];
  }

  return Math.sqrt(sumSquares / samples.length);
}
