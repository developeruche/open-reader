import { create } from 'zustand';
import { MOCK_SENTENCES } from './mockDocument';

export type MockStatus = 'idle' | 'buffering' | 'playing' | 'paused';

export interface MockPlayerState {
  status: MockStatus;
  sentence: number;
  word: number;
  rate: number;
  voice: string;
  follow: boolean;
  toggle(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(sentence: number, word?: number): void;
  setRate(rate: number): void;
  setVoice(voice: string): void;
  setFollow(follow: boolean): void;
}

const WORD_MS = 280;
let timer: ReturnType<typeof setInterval> | undefined;

/** A fake player that advances one word every ~280 ms / rate, for building the shells. */
export const useMockPlayer = create<MockPlayerState>((set, get) => {
  const tick = () => {
    const { sentence, word } = get();
    const s = MOCK_SENTENCES[sentence];
    if (!s) return;
    if (word + 1 < s.words.length) set({ word: word + 1 });
    else if (sentence + 1 < MOCK_SENTENCES.length) set({ sentence: sentence + 1, word: 0 });
    else {
      stop();
      set({ status: 'idle', sentence: 0, word: 0 });
    }
  };
  const start = () => {
    stop();
    timer = setInterval(tick, WORD_MS / get().rate);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const clamp = (n: number) => Math.max(0, Math.min(MOCK_SENTENCES.length - 1, n));
  return {
    status: 'idle',
    sentence: 0,
    word: 0,
    rate: 1,
    voice: 'af_heart',
    follow: true,
    toggle: () => {
      if (get().status === 'playing') {
        stop();
        set({ status: 'paused' });
      } else {
        set({ status: 'playing' });
        start();
      }
    },
    pause: () => {
      stop();
      if (get().status === 'playing') set({ status: 'paused' });
    },
    next: () => set({ sentence: clamp(get().sentence + 1), word: 0 }),
    prev: () => set({ sentence: clamp(get().sentence - 1), word: 0 }),
    seek: (sentence, word = 0) => set({ sentence: clamp(sentence), word }),
    setRate: (rate) => {
      set({ rate });
      if (get().status === 'playing') start();
    },
    setVoice: (voice) => set({ voice }),
    setFollow: (follow) => set({ follow }),
  };
});

/** Seconds left at the current rate, estimated from word counts. */
export function mockTimeLeft(sentence: number, word: number, rate: number): number {
  let words = 0;
  for (let i = sentence; i < MOCK_SENTENCES.length; i++)
    words += MOCK_SENTENCES[i]?.words.length ?? 0;
  return ((words - word) * WORD_MS) / 1000 / rate;
}
