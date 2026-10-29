/**
 * Highlight styles injected with chrome.scripting.insertCSS (ADR 0006): CSS-only, no page DOM
 * changes. Light pages use ink on paper; dark pages use the inverted variant (§3.3).
 */
export const HIGHLIGHT_CSS = `
::highlight(or-sentence) { background-color: rgba(11, 11, 11, 0.08); }
::highlight(or-word) { background-color: #0b0b0b; color: #f6f4ef; }
::highlight(or-sentence-dark) { background-color: rgba(246, 244, 239, 0.16); }
::highlight(or-word-dark) { background-color: #f6f4ef; color: #0b0b0b; }
`;

export type Variant = 'light' | 'dark';

export const highlightNames = (v: Variant) =>
  v === 'dark'
    ? { sentence: 'or-sentence-dark', word: 'or-word-dark' }
    : { sentence: 'or-sentence', word: 'or-word' };
