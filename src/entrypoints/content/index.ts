// Injected on demand by the background (chrome.scripting), never declared statically.
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    // M8: extraction, highlights, cursor, follow-scroll and mini player.
  },
});
