/**
 * Golden normalization cases: display text → spoken text. Includes every pronunciation issue from
 * the owner's PSBT audiobook (spelled acronyms, Piper's "nonce", fee-rate units, BIP numbers).
 */
import { describe, expect, it } from 'vitest';
import { Lexicon } from '@/core/text/lexicon';
import { normalize } from '@/core/text/normalize';

const kokoro = new Lexicon({ engineId: 'kokoro' });
const piper = new Lexicon({ engineId: 'piper' });
const say = (t: string, lexicon = kokoro) => normalize(t, { lexicon }).spoken;

type Case = [input: string, spoken: string];

const AUDIOBOOK: Case[] = [
  ['PSBT', 'P S B T'],
  ['PSBTs', "P S B T's"],
  ["PSBT's", "P S B T's"],
  ['A PSBT is a container.', 'A P S B T is a container.'],
  ['Each PSBT carries UTXO data.', 'Each P S B T carries U T X O data.'],
  ['UTXOs', "U T X O's"],
  ['See BIP 174.', 'See bip 174.'],
  ['BIP 370 extends it.', 'bip 370 extends it.'],
  ['BIPs', "bip's"],
  ['Copy the txid.', 'Copy the T X I D.'],
  ['The sighash flag.', 'The sig hash flag.'],
  ['SIGHASH_ALL', 'sig hash all'],
  ['SIGHASH_SINGLE', 'sig hash single'],
  ['MuSig2 nonces', 'mew sig two nonces'],
  ['MuSig', 'mew sig'],
  ['an xpub', 'an x pub'],
  ['an xprv', 'an x priv'],
  ['12 sat/vB', '12 sats per virtual byte'],
  ['1 sat/vB', '1 sat per virtual byte'],
  ['fees in sat/vB', 'fees in sats per virtual byte'],
  ['250 vB', '250 virtual bytes'],
  ['1 vB', '1 virtual byte'],
  ['400 WU', '400 weight units'],
  ['P2TR outputs', 'P 2 T R outputs'],
  ['P2WPKH', 'P 2 W P K H'],
  ['P2SH', 'P 2 S H'],
  ['Taproot', 'tap root'],
  ['Schnorr signatures', 'shnor signatures'],
  ['secp256k1', 'sec P 256 K 1'],
  ['OP_RETURN', 'op return'],
  ['OP_CHECKSIG', 'op checksig'],
  ['MAX_MONEY', 'max money'],
  ['SegWit', 'seg wit'],
  ['the mempool', 'the mem pool'],
  ['a multisig wallet', 'a multi sig wallet'],
  ['bech32m', 'betch 32 M'],
  ['Bitcoin Core v32.0', 'Bitcoin Core version 32.0'],
  ['0.5 BTC', '0.5 bitcoin'],
  ['1 BTC', '1 bitcoin'],
  ['HWW', 'H W W'],
  ['the EVM', 'the E V M'],
  ['ERC-20 tokens', 'E R C-20 tokens'],
];

const PIPER_ONLY: Case[] = [
  ['a nonce', 'a nonss'],
  ['the nonce is random', 'the nonss is random'],
  ['Nonce reuse', 'nonss reuse'],
];

const ACRONYMS: Case[] = [
  ['HTTP', 'H T T P'],
  ['HTTPS', 'H T T P S'],
  ['CPU', 'C P U'],
  ['GPU', 'G P U'],
  ['USB', 'U S B'],
  ['HTML', 'H T M L'],
  ['CSS', 'C S S'],
  ['DNS', 'D N S'],
  ['TCP', 'T C P'],
  ['UDP', 'U D P'],
  ['SSD', 'S S D'],
  ['LLM', 'L L M'],
  ['LLMs', "L L M's"],
  ['ECDSA', 'E C D S A'],
  ['HTLC', 'H T L C'],
  ['HTLCs', "H T L C's"],
  ['MP3', 'M P 3'],
  ['H2O', 'H 2 O'],
  ['IPv6', 'IPv6'],
  ['US', 'U S'],
  ['UK', 'U K'],
  ['EU', 'E U'],
  ['FBI', 'F B I'],
  ['CEO', 'C E O'],
  ['PDF', 'P D F'],
  ['PDFs', "P D F's"],
  ['TTS', 'T T S'],
  ['ASR', 'A S R'],
  ['WER', 'W E R'],
  ['RTF', 'R T F'],
  ['OPFS', 'O P F S'],
  ['XYZABC', 'X Y Z A B C'],
  ['XYZABCD', 'XYZABCD'],
  ['A', 'A'],
  ['I think', 'I think'],
  ['NASA', 'NASA'],
  ['NATO', 'NATO'],
  ['ASCII', 'ASCII'],
  ['JPEG', 'JPEG'],
  ['RAM', 'RAM'],
  ['COVID', 'COVID'],
  ['FAQ', 'FAQ'],
  ['REST APIs', "REST A P I's"],
  ['World War II', 'World War II'],
  ['Chapter IV', 'Chapter IV'],
  ['Louis XIV', 'Louis XIV'],
  ['THE FOUR ROLES OF SIGNING', 'THE FOUR ROLES OF SIGNING'],
  ['WARNING: DO NOT REUSE KEYS', 'WARNING: DO NOT REUSE KEYS'],
  ['the GPU and CPU', 'the G P U and C P U'],
  ['UTF-8', 'U T F-8'],
];

const SPEAKABLE_AND_LEXICON: Case[] = [
  ['JSON', 'jason'],
  ['YAML', 'yammel'],
  ['yaml', 'yammel'],
  ['TOML', 'tommel'],
  ['npm install', 'N P M install'],
  ['pnpm', 'P N P M'],
  ['SQL', 'S Q L'],
  ['SQLite', 'S Q lite'],
  ['PostgreSQL', 'postgres Q L'],
  ['MySQL', 'my S Q L'],
  ['CLI', 'C L I'],
  ['API', 'A P I'],
  ['APIs', "A P I's"],
  ['URL', 'U R L'],
  ['URLs', "U R L's"],
  ['GitHub', 'git hub'],
  ['GitLab', 'git lab'],
  ['WASM', 'web assembly'],
  ['WebAssembly', 'web assembly'],
  ['WebGPU', 'web G P U'],
  ['stdout', 'standard out'],
  ['stderr', 'standard error'],
  ['stdin', 'standard in'],
  ['a regex', 'a rej ex'],
  ['sudo', 'soo doo'],
  ['nginx', 'engine X'],
  ['kubectl', 'cube control'],
  ['OAuth', 'oh auth'],
  ['async code', 'a sync code'],
  ['the GUI', 'the gooey'],
  ['TypeScript', 'type script'],
  ['JavaScript', 'java script'],
  ['Node.js', 'node J S'],
  ['README', 'read me'],
  ['localhost', 'local host'],
  ['the repo', 'the reepo'],
  ['macOS', 'mac O S'],
  ['iOS', 'eye O S'],
  ['iPadOS', 'eye pad O S'],
  ['Wi-Fi', 'why fye'],
  ['OK', 'okay'],
  ['GIF', 'gif'],
  ['wtxid', 'W T X I D'],
  ['zpub', 'z pub'],
  ['gwei', 'gway'],
  ['a dApp', 'a dee app'],
  ['Ethereum', 'ethereum'],
  ['ETH', 'eth'],
  ['tapscript', 'tap script'],
  ['sats', 'sats'],
];

const ABBREVIATIONS: Case[] = [
  ['Use e.g. a fork.', 'Use for example a fork.'],
  ['Use e.g., a fork.', 'Use for example, a fork.'],
  ['One key, i.e. the master.', 'One key, that is the master.'],
  ['One key, i.e., the master.', 'One key, that is, the master.'],
  ['Apples, pears, etc.', 'Apples, pears, and so on.'],
  ['Apples, etc., then pears.', 'Apples, and so on, then pears.'],
  ['Kokoro vs. Piper', 'Kokoro versus Piper'],
  ['Kokoro vs Piper', 'Kokoro versus Piper'],
  ['Smith et al. found', 'Smith and others found'],
  ['cf. Section 2', 'compare Section 2'],
  ['approx. 5 minutes', 'approximately 5 minutes'],
  ['Dr. Smith', 'Doctor Smith'],
  ['Mr. Jones', 'Mister Jones'],
  ['Mrs. Jones', 'Missus Jones'],
  ['Prof. Lee', 'Professor Lee'],
  ['See Fig. 3.', 'See Figure 3.'],
  ['See Figs. 3 and 4.', 'See Figures 3 and 4.'],
  ['Eq. 2', 'Equation 2'],
  ['No. 5', 'number 5'],
  ['Vol. 2', 'volume 2'],
  ['pp. 10 to 12', 'pages 10 to 12'],
  ['p. 7', 'page 7'],
  ['ca. 1900', 'circa 1900'],
  ['Sept. 5', 'September 5'],
  ['No way', 'No way'],
  ['the Doctor', 'the Doctor'],
];

const SYMBOLS: Case[] = [
  ['A ‖ B', 'A followed by B'],
  ['x ≥ 5', 'x at least 5'],
  ['x ≤ 5', 'x at most 5'],
  ['A → B', 'A to B'],
  ['3 × 4', '3 times 4'],
  ['3×4', '3 times 4'],
  ['Tom & Jerry', 'Tom and Jerry'],
  ['R&D', 'R and D'],
  ['50%', '50 percent'],
  ['50 %', '50 percent'],
  ['~5 minutes', 'about 5 minutes'],
  ['~ 5 minutes', 'about 5 minutes'],
  ['~/bin', '~/bin'],
  ['5 ± 1', '5 plus or minus 1'],
  ['≈ 3', 'about 3'],
  ['a ≠ b', 'a not equal to b'],
  ['100% & 50%', '100 percent and 50 percent'],
  ['input→output', 'input to output'],
];

const NUMBERS: Case[] = [
  ['0x1a', 'hex 1 A'],
  ['0xFF', 'hex F F'],
  ['0x00', 'hex 0 0'],
  ['0xdeadbeef', 'hex D E A D B E E F'],
  ['0x0123456789abcdef01', 'a long hex string'],
  [
    'txid 4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
    'T X I D a long hex string',
  ],
  ['v2', 'version 2'],
  ['v2.0.0', 'version 2.0.0'],
  ['v32.0', 'version 32.0'],
  ['upgrade to v1.31.1 now', 'upgrade to version 1.31.1 now'],
  ['pages 3–5', 'pages 3 to 5'],
  ['pages 3-5', 'pages 3 to 5'],
  ['1990—2000', '1990 to 2000'],
  ['10 – 20', '10 to 20'],
  ['2024-10-28', '2024-10-28'],
  ['COVID-19', 'COVID-19'],
  ['1st', 'first'],
  ['2nd', 'second'],
  ['3rd', 'third'],
  ['4th', 'fourth'],
  ['5th', 'fifth'],
  ['8th', 'eighth'],
  ['9th', 'ninth'],
  ['11th', 'eleventh'],
  ['12th', 'twelfth'],
  ['13th', 'thirteenth'],
  ['20th', 'twentieth'],
  ['21st', 'twenty-first'],
  ['22nd', 'twenty-second'],
  ['23rd', 'twenty-third'],
  ['30th', 'thirtieth'],
  ['40th', 'fortieth'],
  ['99th', 'ninety-ninth'],
  ['100th', 'one hundredth'],
  ['101st', 'one hundred first'],
  ['1000th', 'one thousandth'],
  ['$5', '5 dollars'],
  ['$1', '1 dollar'],
  ['€20', '20 euros'],
  ['£1', '1 pound'],
  ['3.14', '3.14'],
  ['1,000,000', '1,000,000'],
  ['42', '42'],
];

const UNITS: Case[] = [
  ['5 ms', '5 milliseconds'],
  ['1 ms', '1 millisecond'],
  ['5ms', '5 milliseconds'],
  ['3–5 ms', '3 to 5 milliseconds'],
  ['20 µs', '20 microseconds'],
  ['20 ns', '20 nanoseconds'],
  ['326 MB', '326 megabytes'],
  ['1 MB', '1 megabyte'],
  ['92 MB', '92 megabytes'],
  ['1.5 GB', '1.5 gigabytes'],
  ['2 TB', '2 terabytes'],
  ['512 kB', '512 kilobytes'],
  ['512 KB', '512 kilobytes'],
  ['64 KiB', '64 kibibytes'],
  ['16 MiB', '16 mebibytes'],
  ['8 GiB', '8 gibibytes'],
  ['24 kHz', '24 kilohertz'],
  ['440 Hz', '440 hertz'],
  ['3 GHz', '3 gigahertz'],
  ['100 MHz', '100 megahertz'],
  ['5 km', '5 kilometers'],
  ['1 km', '1 kilometer'],
  ['2 kg', '2 kilograms'],
  ['10 mm', '10 millimeters'],
  ['30 cm', '30 centimeters'],
  ['4 kvB', '4 kilo virtual bytes'],
  ['100 vbytes', '100 virtual bytes'],
  ['5 sats/vB', '5 sats per virtual byte'],
  ['MB of data', 'M B of data'],
  ['ms', 'ms'],
];

const SKIPS: Case[] = [
  ['found it [12].', 'found it.'],
  ['found it [12] and more', 'found it and more'],
  ['found it [1][2].', 'found it.'],
  ['found it [3–5].', 'found it.'],
  ['found it [3, 4].', 'found it.'],
  ['found it [a].', 'found it.'],
  ['found it [citation needed].', 'found it.'],
  ['found it [note 2].', 'found it.'],
  ['a claim¹ here', 'a claim here'],
  ['a claim²³.', 'a claim.'],
  ['a claim† here', 'a claim here'],
  ['see https://example.com for more', 'see for more'],
  ['see https://example.com/a/b?c=d.', 'see.'],
  ['see www.example.com today', 'see today'],
  ['(https://example.com)', '()'],
  ['array[0]', 'array[0]'],
  ['a word[12] here', 'a word here'],
  ['it.[3]', 'it.'],
  ['[Note] text', '[Note] text'],
];

const NFKC: Case[] = [
  ['ﬁnal', 'final'],
  ['ﬂow', 'flow'],
  ['eﬀect', 'effect'],
  ['ﬃce', 'ffice'],
  ['ＡＢＣ', 'A B C'],
  ['１２３', '123'],
  ['café', 'café'],
  ['naïve', 'naïve'],
];

const WHITESPACE: Case[] = [
  ['  leading', 'leading'],
  ['trailing  ', 'trailing'],
  ['two  spaces', 'two spaces'],
  ['tab\there', 'tab here'],
  ['line\nbreak', 'line break'],
  ['before , comma', 'before, comma'],
  ['end .', 'end.'],
  ['question ?', 'question?'],
  ['', ''],
  ['   ', ''],
];

const COMBINED: Case[] = [
  [
    'A PSBT lets several wallets cooperate, e.g. a laptop and a hardware signer.',
    'A P S B T lets several wallets cooperate, for example a laptop and a hardware signer.',
  ],
  [
    'The fee was 12 sat/vB for 141 vB, i.e. 1,692 sats.',
    'The fee was 12 sats per virtual byte for 141 virtual bytes, that is 1,692 sats.',
  ],
  [
    'Kokoro on WebGPU runs at ~9× real time.',
    'Kokoro on web G P U runs at about 9 times real time.',
  ],
  ['Dr. Smith measured 42 ms in v3.2.', 'Doctor Smith measured 42 milliseconds in version 3.2.'],
  [
    'Since BIP 341 (Taproot), Schnorr signatures are 64 bytes.',
    'Since bip 341 (tap root), shnor signatures are 64 bytes.',
  ],
  [
    'Download 326 MB once; after that it works offline.',
    'Download 326 megabytes once; after that it works offline.',
  ],
  ['The 2nd input spends a P2TR output [4].', 'The second input spends a P 2 T R output.'],
  ['Read the JSON via the API & CLI.', 'Read the jason via the A P I and C L I.'],
  ['Upgrade to v28.0, then restart.', 'Upgrade to version 28.0, then restart.'],
  ['UTXOs ≥ 546 sats are spendable.', "U T X O's at least 546 sats are spendable."],
  ['See Fig. 2 and pp. 10–12.', 'See Figure 2 and pages 10 to 12.'],
  ['It costs $5, i.e., less than 1%.', 'It costs 5 dollars, that is, less than 1 percent.'],
  ['The GPU (an M3 Max) handled it.', 'The G P U (an M 3 Max) handled it.'],
  ['MuSig2 needs two rounds of nonces.', 'mew sig two needs two rounds of nonces.'],
  ['Visit https://bitcoinops.org for news¹.', 'Visit for news.'],
  ['The 21st century & beyond.', 'The twenty-first century and beyond.'],
  ['Use snake_case names in Python.', 'Use snake case names in Python.'],
  ['OP_RETURN outputs carry 80 bytes.', 'op return outputs carry 80 bytes.'],
  ['xpub → address', 'x pub to address'],
  ['A ‖ B ‖ C', 'A followed by B followed by C'],
  ['The LLM scored 7.9% WER.', 'The L L M scored 7.9 percent W E R.'],
  ['Pages 3-5 cover SegWit.', 'Pages 3 to 5 cover seg wit.'],
  ['Hex 0xff and version v1.', 'Hex hex F F and version version 1.'],
  ['He was No. 1 in class.', 'He was number 1 in class.'],
  ['ﬁle the PSBT.', 'file the P S B T.'],
];

const INLINE_CODE: [string, [number, number], string][] = [
  ['Call getUserName() now.', [5, 18], 'Call get user name now.'],
  ['Set max_fee_rate first.', [4, 16], 'Set max fee rate first.'],
  ['Use fetchJSON here.', [4, 13], 'Use fetch jason here.'],
  ['Run psbt.combine() later.', [4, 18], 'Run psbt dot combine later.'],
  ['Read parseHTTPHeader.', [5, 20], 'Read parse H T T P header.'],
  ['Plain camelCase stays.', [-1, -1], 'Plain camelCase stays.'],
];

function table(name: string, cases: Case[], lexicon = kokoro) {
  describe(name, () => {
    it.each(cases)('%j → %j', (input, spoken) => {
      expect(say(input, lexicon)).toBe(spoken);
    });
  });
}

table('audiobook pronunciations', AUDIOBOOK);
table('piper-only lexicon', PIPER_ONLY, piper);
table('acronyms', ACRONYMS);
table('speakable words and lexicon packs', SPEAKABLE_AND_LEXICON);
table('abbreviations', ABBREVIATIONS);
table('symbols', SYMBOLS);
table('numbers', NUMBERS);
table('units', UNITS);
table('inline skips', SKIPS);
table('NFKC', NFKC);
table('whitespace', WHITESPACE);
table('combined sentences', COMBINED);

describe('inline code', () => {
  it.each(INLINE_CODE)('%j → %j', (input, [s, e], spoken) => {
    const marks = s >= 0 ? [{ start: s, end: e, kind: 'code' as const }] : [];
    expect(normalize(input, { lexicon: kokoro, marks }).spoken).toBe(spoken);
  });
});

describe('engine-specific entries', () => {
  it('only Piper respells nonce', () => {
    expect(say('a nonce', kokoro)).toBe('a nonce');
    expect(say('a nonce', piper)).toBe('a nonss');
  });

  it('user entries win over packs and built-ins', () => {
    const lx = new Lexicon({
      user: [{ match: 'PSBT', say: 'pizz bit', caseSensitive: true }],
      engineId: 'kokoro',
    });
    expect(say('A PSBT.', lx)).toBe('A pizz bit.');
  });

  it('URL reading can be turned on', () => {
    expect(
      normalize('see https://www.example.com/x today', {
        skips: { citations: true, footnoteMarkers: true, urls: 'say' },
      }).spoken,
    ).toBe('see link to example dot com today');
  });

  it('citations can be read', () => {
    expect(
      normalize('it [12] is', { skips: { citations: false, footnoteMarkers: true, urls: 'skip' } })
        .spoken,
    ).toBe('it [12] is');
  });
});

const total =
  AUDIOBOOK.length +
  PIPER_ONLY.length +
  ACRONYMS.length +
  SPEAKABLE_AND_LEXICON.length +
  ABBREVIATIONS.length +
  SYMBOLS.length +
  NUMBERS.length +
  UNITS.length +
  SKIPS.length +
  NFKC.length +
  WHITESPACE.length +
  COMBINED.length +
  INLINE_CODE.length;

it('has more than 300 golden cases', () => {
  expect(total).toBeGreaterThan(300);
});
