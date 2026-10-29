/** The subset of chrome.tts the system voice needs, so it can be bridged across contexts. */

export interface TtsVoice {
  voiceName: string;
  lang?: string;
  remote?: boolean;
  eventTypes?: string[];
}

export interface TtsEvent {
  type:
    | 'start'
    | 'word'
    | 'sentence'
    | 'end'
    | 'interrupted'
    | 'cancelled'
    | 'error'
    | 'pause'
    | 'resume'
    | 'marker';
  charIndex?: number;
  errorMessage?: string;
}

export interface TtsSpeakOptions {
  voiceName?: string;
  lang?: string;
  rate: number;
}

export interface TtsApi {
  speak(text: string, opts: TtsSpeakOptions, onEvent: (e: TtsEvent) => void): void;
  pause(): void;
  resume(): void;
  stop(): void;
  getVoices(): Promise<TtsVoice[]>;
}
