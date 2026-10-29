/** Realistic placeholder content for the M2 shells (replaced by real extraction in M8/M9). */
export interface MockSentence {
  id: string;
  text: string;
  words: { start: number; end: number }[];
}
export interface MockBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'listItem';
  level?: number;
  sentences: MockSentence[];
  /** Skipped by reading rules: shown, but muted and not clickable. */
  muted?: boolean;
}
export interface MockDocument {
  title: string;
  site: string;
  blocks: MockBlock[];
}

const RAW: { type: MockBlock['type']; level?: number; text: string }[] = [
  {
    type: 'heading',
    level: 1,
    text: 'How a partially signed Bitcoin transaction moves between wallets',
  },
  {
    type: 'paragraph',
    text: 'A PSBT is a container for a transaction that is not finished yet. Each wallet that touches it adds what it knows, and nobody has to trust anybody else with private keys. The format is defined in BIP 174 and extended by BIP 370.',
  },
  { type: 'heading', level: 2, text: 'The four roles' },
  { type: 'listItem', text: 'The creator proposes the inputs and outputs.' },
  { type: 'listItem', text: 'The updater adds UTXO data, scripts and derivation paths.' },
  { type: 'listItem', text: 'Each signer checks the amounts and adds a partial signature.' },
  {
    type: 'listItem',
    text: 'The finalizer assembles the witness and extracts a transaction ready to broadcast.',
  },
  { type: 'heading', level: 2, text: 'Why hardware wallets like it' },
  {
    type: 'paragraph',
    text: 'A signing device can show the real fee before it signs, because the PSBT carries the full previous outputs. That closes the fee-inflation attack that once affected SegWit signers. It also means an air-gapped device can sign from a QR code or an SD card.',
  },
  {
    type: 'paragraph',
    text: 'Taproot added fields for key paths, script paths and MuSig2 nonces. Most wallets released after 2024 read them, but older firmware may silently drop what it does not understand.',
  },
];

function segment(text: string, granularity: 'sentence' | 'word') {
  return [...new Intl.Segmenter('en', { granularity }).segment(text)];
}

export function buildMockDocument(): MockDocument {
  const blocks = RAW.map((b, bi) => ({
    id: `b${bi}`,
    type: b.type,
    level: b.level,
    sentences: segment(b.text, 'sentence').map((s, si) => {
      const text = s.segment.trimEnd();
      return {
        id: `b${bi}s${si}`,
        text,
        words: segment(text, 'word')
          .filter((w) => w.isWordLike)
          .map((w) => ({ start: w.index, end: w.index + w.segment.length })),
      };
    }),
  }));
  return { title: RAW[0]?.text ?? '', site: 'bitcoinops.org', blocks };
}

export const MOCK_DOC = buildMockDocument();
export const MOCK_SENTENCES = MOCK_DOC.blocks.flatMap((b) =>
  b.sentences.map((s) => ({ ...s, blockId: b.id })),
);

export const MOCK_VOICES = [
  { id: 'af_heart', name: 'Heart', detail: 'Kokoro · US English' },
  { id: 'am_michael', name: 'Michael', detail: 'Kokoro · US English' },
  { id: 'bf_emma', name: 'Emma', detail: 'Kokoro · UK English' },
  { id: 'bm_george', name: 'George', detail: 'Kokoro · UK English' },
  { id: 'lessac-high', name: 'Classic', detail: 'Piper · US English' },
] as const;
