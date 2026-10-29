/** chrome.tts as a TtsApi (background and extension pages; the offscreen document has no tts). */
import { browser } from 'wxt/browser';
import type { TtsApi, TtsEvent, TtsVoice } from '@/engines/system/tts';

export function chromeTts(): TtsApi {
  return {
    speak(text, opts, onEvent) {
      void browser.tts.speak(text, {
        voiceName: opts.voiceName,
        lang: opts.lang,
        rate: Math.max(0.1, Math.min(10, opts.rate)),
        enqueue: false,
        onEvent: (e) =>
          onEvent({
            type: e.type as TtsEvent['type'],
            charIndex: e.charIndex,
            errorMessage: e.errorMessage,
          }),
      });
    },
    pause: () => browser.tts.pause(),
    resume: () => browser.tts.resume(),
    stop: () => browser.tts.stop(),
    async getVoices(): Promise<TtsVoice[]> {
      const voices = await browser.tts.getVoices();
      return voices.map((v) => ({
        voiceName: v.voiceName ?? '',
        lang: v.lang,
        remote: v.remote,
        eventTypes: v.eventTypes as string[] | undefined,
      }));
    },
  };
}
