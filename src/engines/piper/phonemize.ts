/** espeak-ng phonemes via piper_phonemize (WASM), instantiated once per worker and reused. */
// @ts-expect-error -- emscripten CommonJS module without types; Vite converts it to ESM.
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import type { Phonemize } from './engine';

interface PhonemizeModule {
  callMain(args: string[]): void;
}

export function createPhonemizer(assetBase: string): Phonemize {
  let pending: ((ids: number[]) => void) | undefined;
  let failed: ((e: Error) => void) | undefined;
  const ready: Promise<PhonemizeModule> = (
    createPiperPhonemize as (o: object) => Promise<PhonemizeModule>
  )({
    print: (data: string) => pending?.((JSON.parse(data) as { phoneme_ids: number[] }).phoneme_ids),
    printErr: (m: string) => failed?.(new Error(m)),
    locateFile: (u: string) => `${assetBase}${u.split('/').pop() ?? u}`,
  });
  let queue: Promise<unknown> = Promise.resolve();
  return (text, voice) => {
    // callMain is synchronous and single-threaded: serialize calls.
    const run = queue.then(async () => {
      const mod = await ready;
      return new Promise<number[]>((resolve, reject) => {
        pending = resolve;
        failed = reject;
        mod.callMain([
          '-l',
          voice,
          '--input',
          JSON.stringify([{ text }]),
          '--espeak_data',
          '/espeak-ng-data',
        ]);
      });
    });
    queue = run.catch(() => undefined);
    return run;
  };
}
