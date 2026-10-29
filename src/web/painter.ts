/** Paints the current sentence and word with the CSS Custom Highlight API (PLAN.md §7.2). */
import { highlightNames, type Variant } from './highlightCss';

export class HighlightPainter {
  private variant: Variant = 'light';
  sentence: Range[] = [];
  word: Range | undefined;

  setVariant(v: Variant): void {
    if (v === this.variant) return;
    this.clear();
    this.variant = v;
    this.apply();
  }

  /** A sentence may span pages (PDF), so it accepts several ranges. */
  paint(sentence: Range | Range[] | undefined, word: Range | undefined): void {
    this.sentence = sentence === undefined ? [] : Array.isArray(sentence) ? sentence : [sentence];
    this.word = word;
    this.apply();
  }

  clear(): void {
    const n = highlightNames(this.variant);
    CSS.highlights.delete(n.sentence);
    CSS.highlights.delete(n.word);
  }

  private apply(): void {
    const n = highlightNames(this.variant);
    if (this.sentence.length) CSS.highlights.set(n.sentence, new Highlight(...this.sentence));
    else CSS.highlights.delete(n.sentence);
    if (this.word) CSS.highlights.set(n.word, new Highlight(this.word));
    else CSS.highlights.delete(n.word);
  }
}
