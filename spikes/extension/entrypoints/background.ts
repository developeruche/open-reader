// Spike background: owns the offscreen document and records its lifecycle.
const events: { t: number; e: string }[] = [];
const log = (e: string) => events.push({ t: Date.now(), e });

async function hasOffscreen(): Promise<boolean> {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] });
  return ctx.length > 0;
}

async function ensureOffscreen(reasons: string[] = ['AUDIO_PLAYBACK', 'WORKERS']): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: reasons as chrome.offscreen.Reason[],
    justification: 'Spike: TTS engine host',
  });
  log(`offscreen-created:${reasons.join('+')}`);
}

export default defineBackground(() => {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'offscreen') return;
    log('port-connected');
    port.onDisconnect.addListener(() => log('port-disconnected'));
  });
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.target === 'offscreen') return false;
    (async () => {
      switch (msg.type) {
        case 'ensure-offscreen':
          await ensureOffscreen(msg.reasons);
          return { ok: true };
        case 'has-offscreen':
          return { present: await hasOffscreen() };
        case 'close-offscreen':
          if (await hasOffscreen()) await chrome.offscreen.closeDocument();
          log('offscreen-closed-forced');
          return { ok: true };
        case 'events':
          return { events };
        default:
          return undefined;
      }
    })().then(reply);
    return true;
  });
  (globalThis as unknown as { spikeEvents: typeof events }).spikeEvents = events;
});
