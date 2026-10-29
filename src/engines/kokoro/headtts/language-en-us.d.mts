// Types for the vendored HeadTTS en-us G2P (MIT, met4citizen/HeadTTS@5ae6d5e).
export interface GenerateResult {
  phonemes: string[];
  metadata: { words: string[]; wtimes: number[]; wdurations: number[] };
  silences: [number, number][];
}

export class Language {
  constructor(settings?: { trace?: boolean } | null);
  loadDictionary(url?: string | null, force?: boolean): Promise<void>;
  generate(input: string): GenerateResult;
}
