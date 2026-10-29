/** Pronunciation lexicon (PLAN.md §5.2.4): user entries, then domain packs, then built-ins. */
import { z } from 'zod';
import { RewriteBuilder, type Rewrite } from './offsetMap';

export interface LexiconEntry {
  /** A whole word/phrase, or a RegExp (its `say` may use $1…$9). */
  match: string | RegExp;
  say: string;
  /** Only for these engine ids; all engines when absent. */
  engines?: string[];
  caseSensitive?: boolean;
}

export interface LexiconPack {
  id: string;
  name: string;
  entries: LexiconEntry[];
}

/** Spells letters with spaces: "UTXO" → "U T X O". */
const spell = (s: string) => s.split('').join(' ');

export const BUILTIN_PACK: LexiconPack = {
  id: 'builtin',
  name: 'Built-in',
  entries: [
    { match: 'macOS', say: 'mac O S', caseSensitive: true },
    { match: 'iOS', say: 'eye O S', caseSensitive: true },
    { match: 'iPadOS', say: 'eye pad O S', caseSensitive: true },
    { match: 'Wi-Fi', say: 'why fye' },
    { match: 'GIF', say: 'gif', caseSensitive: true },
    { match: 'OK', say: 'okay', caseSensitive: true },
  ],
};

export const PROGRAMMING_PACK: LexiconPack = {
  id: 'programming',
  name: 'Programming',
  entries: [
    { match: 'npm', say: 'N P M' },
    { match: 'pnpm', say: 'P N P M' },
    { match: 'SQL', say: 'S Q L', caseSensitive: true },
    { match: 'SQLite', say: 'S Q lite' },
    { match: 'PostgreSQL', say: 'postgres Q L' },
    { match: 'MySQL', say: 'my S Q L' },
    { match: 'CLI', say: 'C L I', caseSensitive: true },
    { match: 'API', say: 'A P I', caseSensitive: true },
    { match: 'URL', say: 'U R L', caseSensitive: true },
    { match: 'JSON', say: 'jason', caseSensitive: true },
    { match: 'YAML', say: 'yammel' },
    { match: 'TOML', say: 'tommel', caseSensitive: true },
    { match: 'GitHub', say: 'git hub' },
    { match: 'GitLab', say: 'git lab' },
    { match: 'WASM', say: 'web assembly', caseSensitive: true },
    { match: 'WebAssembly', say: 'web assembly' },
    { match: 'WebGPU', say: 'web G P U' },
    { match: 'stdout', say: 'standard out' },
    { match: 'stderr', say: 'standard error' },
    { match: 'stdin', say: 'standard in' },
    { match: 'regex', say: 'rej ex' },
    { match: 'sudo', say: 'soo doo' },
    { match: 'nginx', say: 'engine X' },
    { match: 'kubectl', say: 'cube control' },
    { match: 'OAuth', say: 'oh auth' },
    { match: 'async', say: 'a sync' },
    { match: 'GUI', say: 'gooey', caseSensitive: true },
    { match: 'TypeScript', say: 'type script' },
    { match: 'JavaScript', say: 'java script' },
    { match: 'Node.js', say: 'node J S' },
    { match: 'README', say: 'read me' },
    { match: 'localhost', say: 'local host' },
    { match: 'dev', say: 'dev' },
    { match: 'repo', say: 'reepo' },
  ],
};

export const BITCOIN_PACK: LexiconPack = {
  id: 'bitcoin',
  name: 'Bitcoin and Ethereum',
  entries: [
    { match: 'PSBT', say: spell('PSBT'), caseSensitive: true },
    { match: 'UTXO', say: spell('UTXO'), caseSensitive: true },
    { match: 'txid', say: 'T X I D' },
    { match: 'wtxid', say: 'W T X I D' },
    { match: 'BIP', say: 'bip', caseSensitive: true },
    { match: 'sighash', say: 'sig hash' },
    { match: 'SIGHASH', say: 'sig hash', caseSensitive: true },
    { match: 'MuSig2', say: 'mew sig two' },
    { match: 'MuSig', say: 'mew sig' },
    { match: 'xpub', say: 'x pub' },
    { match: 'xprv', say: 'x priv' },
    { match: 'zpub', say: 'z pub' },
    { match: 'EVM', say: spell('EVM'), caseSensitive: true },
    { match: 'ERC', say: spell('ERC'), caseSensitive: true },
    { match: 'nonce', say: 'nonss', engines: ['piper'] },
    { match: 'Schnorr', say: 'shnor' },
    { match: 'SegWit', say: 'seg wit' },
    { match: 'segwit', say: 'seg wit' },
    { match: 'mempool', say: 'mem pool' },
    { match: 'multisig', say: 'multi sig' },
    { match: 'secp256k1', say: 'sec P 256 K 1' },
    { match: 'bech32m', say: 'betch 32 M' },
    { match: 'bech32', say: 'betch 32' },
    { match: 'gwei', say: 'gway' },
    { match: 'dApp', say: 'dee app' },
    { match: 'Ethereum', say: 'ethereum' },
    { match: 'ETH', say: 'eth', caseSensitive: true },
    { match: 'sats', say: 'sats' },
    { match: 'Taproot', say: 'tap root' },
    { match: 'tapscript', say: 'tap script' },
    { match: /\bOP_([A-Z0-9]+)\b/, say: 'op $1' },
  ],
};

export const DOMAIN_PACKS: LexiconPack[] = [PROGRAMMING_PACK, BITCOIN_PACK];

export interface LexiconOptions {
  user?: LexiconEntry[];
  packs?: LexiconPack[];
  engineId?: string;
}

interface CompiledEntry {
  re: RegExp;
  entry: LexiconEntry;
  /** Plain all-caps keys also match a plural "s" and say it as "'s". */
  plural: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Lexicon {
  private readonly compiled: CompiledEntry[];
  private readonly keys = new Set<string>();

  constructor(opts: LexiconOptions = {}) {
    const ordered = [
      ...(opts.user ?? []),
      ...(opts.packs ?? DOMAIN_PACKS).flatMap((p) => p.entries),
      ...BUILTIN_PACK.entries,
    ];
    this.compiled = ordered
      .filter(
        (e) => !e.engines || (opts.engineId !== undefined && e.engines.includes(opts.engineId)),
      )
      .map((entry) => {
        if (entry.match instanceof RegExp) {
          const flags = entry.match.flags.includes('g')
            ? entry.match.flags
            : `${entry.match.flags}g`;
          return { re: new RegExp(entry.match.source, flags), entry, plural: false };
        }
        const plural = /^[A-Z0-9]{2,}$/.test(entry.match);
        this.keys.add(entry.caseSensitive ? entry.match : entry.match.toLowerCase());
        const body = escapeRe(entry.match) + (plural ? "(?:s|['’]s)?" : '');
        return {
          re: new RegExp(
            `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`,
            entry.caseSensitive ? 'gu' : 'giu',
          ),
          entry,
          plural,
        };
      });
  }

  /** True if `word` (or its singular) has an entry; the acronym rule leaves these alone. */
  has(word: string): boolean {
    const stem = word.replace(/(?:s|['’]s)$/, '');
    return [word, stem].some((w) => this.keys.has(w) || this.keys.has(w.toLowerCase()));
  }

  apply(text: string): Rewrite {
    const taken: { start: number; end: number; say: string }[] = [];
    const overlaps = (s: number, e: number) => taken.some((t) => s < t.end && e > t.start);
    for (const { re, entry, plural } of this.compiled) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        const s = m.index;
        const e = s + m[0].length;
        if (overlaps(s, e)) continue;
        let say: string;
        if (entry.match instanceof RegExp) {
          say = m[0]
            .replace(new RegExp(entry.match.source, entry.match.flags.replace('g', '')), entry.say)
            .toLowerCase();
        } else {
          say = entry.say;
          if (plural && e - s > entry.match.length) say += "'s";
        }
        taken.push({ start: s, end: e, say });
      }
    }
    taken.sort((a, b) => a.start - b.start);
    const b = new RewriteBuilder(text);
    for (const t of taken) b.replace(t.start, t.end, t.say);
    return b.finish();
  }
}

// ── stored user entries (the pronunciation editor, JSON import/export) ──────

export const StoredEntrySchema = z.object({
  id: z.string().min(1),
  /** The written form, or a regular expression source when `regex` is set. */
  match: z.string().min(1).max(200),
  say: z.string().max(400),
  regex: z.boolean().optional(),
  engines: z.array(z.string()).optional(),
  caseSensitive: z.boolean().optional(),
});
export type StoredEntry = z.infer<typeof StoredEntrySchema>;

/** The JSON file the editor imports and exports. */
export const LexiconFileSchema = z.object({
  format: z.literal('open-reader-lexicon'),
  version: z.literal(1),
  entries: z.array(StoredEntrySchema.omit({ id: true }).extend({ id: z.string().optional() })),
});
export type LexiconFile = z.infer<typeof LexiconFileSchema>;

/** Stored entries → lexicon entries; invalid regular expressions are dropped. */
export function compileEntries(stored: readonly StoredEntry[]): LexiconEntry[] {
  const out: LexiconEntry[] = [];
  for (const e of stored) {
    let match: string | RegExp = e.match;
    if (e.regex) {
      try {
        match = new RegExp(e.match, e.caseSensitive ? 'u' : 'iu');
      } catch {
        continue;
      }
    }
    out.push({
      match,
      say: e.say,
      ...(e.engines?.length ? { engines: e.engines } : {}),
      ...(e.caseSensitive ? { caseSensitive: true } : {}),
    });
  }
  return out;
}

/** What a session carries to its engine host: user entries and enabled packs. */
export interface LexiconConfig {
  user: StoredEntry[];
  packs: string[];
}

export function lexiconFrom(config: LexiconConfig | undefined, engineId: string): Lexicon {
  if (!config) return new Lexicon({ engineId });
  return new Lexicon({
    engineId,
    user: compileEntries(config.user),
    packs: DOMAIN_PACKS.filter((p) => config.packs.includes(p.id)),
  });
}
