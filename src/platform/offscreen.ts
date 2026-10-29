/**
 * Offscreen document manager. Reasons AUDIO_PLAYBACK + WORKERS keep Chrome from closing the host
 * 30 s after a pause (ADR 0005); recovery still handles closure.
 */
import { browser } from 'wxt/browser';

const URL_PATH = 'offscreen.html';
let creating: Promise<void> | undefined;

export async function offscreenExists(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await offscreenExists()) return;
  creating ??= browser.offscreen
    .createDocument({
      url: URL_PATH,
      reasons: [browser.offscreen.Reason.AUDIO_PLAYBACK, browser.offscreen.Reason.WORKERS],
      justification: 'Runs the on-device text-to-speech engine and plays its audio.',
    })
    .catch((e: unknown) => {
      // Another context created it between the check and the call.
      if (!String(e).includes('Only a single offscreen')) throw e;
    })
    .finally(() => {
      creating = undefined;
    });
  await creating;
}

export async function closeOffscreen(): Promise<void> {
  if (await offscreenExists()) await browser.offscreen.closeDocument();
}
