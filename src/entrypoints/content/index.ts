// Injected on demand by the background (chrome.scripting), never declared statically.
import { connectWithRetry } from '@/platform/ports';
import { PORT, type ContentMessage, type ContentUpdate } from '@/runtime/protocol';
import { ContentApp } from '@/web/contentApp';

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    const g = globalThis as { __openReaderContent?: ContentApp };
    if (g.__openReaderContent) return;
    const port = connectWithRetry<ContentUpdate, ContentMessage>({
      name: PORT.content,
      onMessage: (msg) => app.handle(msg),
    });
    const app = new ContentApp((m) => port.post(m));
    g.__openReaderContent = app;
    // Test builds expose the current highlights to Playwright through a DOM attribute.
    if (import.meta.env.MODE === 'test') {
      setInterval(() => {
        const word = CSS.highlights.get('or-word') ?? CSS.highlights.get('or-word-dark');
        const sentence =
          CSS.highlights.get('or-sentence') ?? CSS.highlights.get('or-sentence-dark');
        const w = word ? [...word][0] : undefined;
        const s = sentence ? [...sentence][0] : undefined;
        document.documentElement.dataset.orWord = w instanceof Range ? w.toString() : '';
        document.documentElement.dataset.orSentence = s instanceof Range ? s.toString() : '';
        document.documentElement.dataset.orVariant =
          CSS.highlights.has('or-word-dark') || CSS.highlights.has('or-sentence-dark')
            ? 'dark'
            : 'light';
        document.documentElement.dataset.orFollow = app.follow.suspended ? 'suspended' : 'on';
        document.documentElement.dataset.orDrift = `${app.follower.maxDriftMs.toFixed(1)}/${app.follower.driftSamples}/${app.follower.maxSettleMs.toFixed(1)}`;
        document.documentElement.dataset.orDrifts = app.follower.drifts
          .map((d) => d.toFixed(1))
          .join(',');
      }, 50);
    }
  },
});
