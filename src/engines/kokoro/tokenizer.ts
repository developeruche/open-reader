/** Kokoro's character-level tokenizer (tokenizer.json: vocab, `$` = 0 pads both ends). */

export interface KokoroTokenizer {
  /** Token ids for a phoneme string, with the pads. */
  encode(phonemes: string): { ids: number[]; tokenOf: Int32Array };
}

interface TokenizerJson {
  model: { vocab: Record<string, number> };
}

export function createTokenizer(json: TokenizerJson): KokoroTokenizer {
  const vocab = json.model.vocab;
  return {
    encode(phonemes) {
      const ids = [0];
      // tokenOf[i] = token index of phoneme char i (characters outside the vocab are dropped, as
      // the tokenizer's normalizer does; they map to the next kept token).
      const chars = [...phonemes];
      const tokenOf = new Int32Array(chars.length + 1);
      chars.forEach((c, i) => {
        tokenOf[i] = ids.length;
        const id = vocab[c];
        if (id !== undefined) ids.push(id);
      });
      tokenOf[chars.length] = ids.length;
      ids.push(0);
      return { ids, tokenOf };
    },
  };
}
