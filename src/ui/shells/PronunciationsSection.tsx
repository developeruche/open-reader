/**
 * Pronunciations (PLAN.md §5.2.4, M11): domain packs, user entries with a Test button in the
 * current voice, and JSON import/export. Changes reach open sessions through `lexiconRevision`.
 */
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '@/core/settings';
import {
  DOMAIN_PACKS,
  LexiconFileSchema,
  StoredEntrySchema,
  type LexiconFile,
  type StoredEntry,
} from '@/core/text/lexicon';
import { IdbLexicon } from '@/platform/lexicon';
import { loadSettings, saveSettings } from '@/platform/settings';
import { chromeTts } from '@/platform/tts';
import { testPronunciation } from '@/runtime/models';
import { Type } from '../icons';
import { Button, EmptyState, Select, Skeleton, TextField, Toggle, toast } from '../components';

const ENGINES = [
  { value: 'all', label: 'All voices' },
  { value: 'kokoro', label: 'Kokoro only' },
  { value: 'piper', label: 'Piper only' },
  { value: 'system', label: 'System voices only' },
];

interface Draft {
  id: string | null;
  match: string;
  say: string;
  engine: string;
  caseSensitive: boolean;
}

const EMPTY: Draft = { id: null, match: '', say: '', engine: 'all', caseSensitive: false };

const engineLabel = (e: StoredEntry) =>
  ENGINES.find((x) => x.value === (e.engines?.[0] ?? 'all'))?.label ?? 'All voices';

export function PronunciationsSection() {
  const [lexicon] = useState(() => new IdbLexicon());
  const [entries, setEntries] = useState<StoredEntry[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void lexicon.list().then(setEntries);
    void loadSettings().then(setSettings);
  }, [lexicon]);

  /** Saves and tells open sessions to re-plan with the new pronunciations. */
  const changed = async () => {
    setEntries(await lexicon.list());
    const s = await loadSettings();
    setSettings(await saveSettings({ lexiconRevision: s.lexiconRevision + 1 }));
  };

  const toEntry = (d: Draft): StoredEntry => ({
    id: d.id ?? crypto.randomUUID(),
    match: d.match.trim(),
    say: d.say.trim(),
    ...(d.engine !== 'all' ? { engines: [d.engine] } : {}),
    ...(d.caseSensitive ? { caseSensitive: true } : {}),
  });

  const save = async () => {
    if (!draft.match.trim()) return setError('Enter the word as it is written.');
    if (!draft.say.trim()) return setError('Enter how it should sound.');
    const dupe = entries?.find(
      (e) => e.id !== draft.id && e.match.toLowerCase() === draft.match.trim().toLowerCase(),
    );
    if (dupe) return setError(`“${dupe.match}” already has a pronunciation. Edit it instead.`);
    setError(undefined);
    await lexicon.put(toEntry(draft));
    setDraft(EMPTY);
    await changed();
  };

  const test = async (e: StoredEntry) => {
    try {
      const tts = chromeTts();
      const spoken = await testPronunciation(e, settings?.voice ?? null, (text) =>
        tts.speak(text, { rate: 1 }, () => undefined),
      );
      toast({
        kind: 'info',
        title: 'Playing the test',
        description: `The voice says: “${spoken}”`,
      });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'The test could not play',
        description: `${err instanceof Error ? err.message : String(err)}. Check Settings → Voices & models.`,
      });
    }
  };

  const exportJson = () => {
    const file: LexiconFile = {
      format: 'open-reader-lexicon',
      version: 1,
      entries: (entries ?? []).map(({ id: _id, ...rest }) => rest),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'open-reader-pronunciations.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (f: File) => {
    let parsed: LexiconFile;
    try {
      parsed = LexiconFileSchema.parse(JSON.parse(await f.text()));
    } catch {
      toast({
        kind: 'error',
        title: 'That file is not an Open Reader pronunciation list',
        description: 'Export a list from this page to see the expected format.',
      });
      return;
    }
    // Merge: an imported spelling replaces an existing one with the same written form.
    const byMatch = new Map((entries ?? []).map((e) => [e.match.toLowerCase(), e]));
    for (const e of parsed.entries)
      byMatch.set(
        e.match.toLowerCase(),
        StoredEntrySchema.parse({ ...e, id: e.id ?? crypto.randomUUID() }),
      );
    await lexicon.replaceAll([...byMatch.values()]);
    await changed();
    toast({ kind: 'success', title: `Imported ${parsed.entries.length} pronunciations` });
  };

  return (
    <section aria-labelledby="section-title" className="max-w-2xl">
      <h1
        id="section-title"
        className="font-serif text-[30px] leading-tight tracking-[-0.02em] text-balance"
      >
        Pronunciations
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        Teach the voice how to say names and terms. Your entries come first, then the packs.
      </p>

      <div className="mt-8">
        <h2 className="font-serif text-lg tracking-tight">Packs</h2>
        <div className="mt-2 divide-y divide-line border-y border-line">
          {DOMAIN_PACKS.map((p) => (
            <Toggle
              key={p.id}
              label={p.name}
              description={`${p.entries.length} terms, such as ${p.entries
                .slice(0, 3)
                .map((e) => (typeof e.match === 'string' ? e.match : 'patterns'))
                .join(', ')}.`}
              checked={settings?.packs.includes(p.id) ?? true}
              disabled={!settings}
              onCheckedChange={(on) => {
                const packs = new Set(settings?.packs ?? []);
                if (on) packs.add(p.id);
                else packs.delete(p.id);
                void saveSettings({
                  packs: [...packs],
                  lexiconRevision: (settings?.lexiconRevision ?? 0) + 1,
                }).then(setSettings);
              }}
            />
          ))}
        </div>

        <h2 className="mt-10 font-serif text-lg tracking-tight">
          {draft.id ? 'Edit pronunciation' : 'Add a pronunciation'}
        </h2>
        <form
          className="mt-3 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField
            name="match"
            label="Written as"
            placeholder="e.g. Schnorr…"
            value={draft.match}
            onChange={(match) => setDraft({ ...draft, match })}
            literal
            error={error && !draft.match.trim() ? error : undefined}
          />
          <TextField
            name="say"
            label="Say it as"
            placeholder="e.g. shnor…"
            hint="Spell it the way it sounds; spaces between letters spell them out."
            value={draft.say}
            onChange={(say) => setDraft({ ...draft, say })}
            literal
            error={error && draft.match.trim() ? error : undefined}
          />
          <Select
            label="Voices"
            value={draft.engine}
            options={ENGINES}
            onValueChange={(engine) => setDraft({ ...draft, engine })}
          />
          <div className="self-end">
            <Toggle
              label="Match case exactly"
              checked={draft.caseSensitive}
              onCheckedChange={(caseSensitive) => setDraft({ ...draft, caseSensitive })}
            />
          </div>
          <div className="flex gap-3 sm:col-span-2">
            <Button type="submit" variant="primary">
              {draft.id ? 'Save changes' : 'Add pronunciation'}
            </Button>
            {draft.match.trim() && draft.say.trim() ? (
              <Button onClick={() => void test(toEntry(draft))}>Test</Button>
            ) : null}
            {draft.id ? (
              <Button variant="ghost" onClick={() => (setDraft(EMPTY), setError(undefined))}>
                Cancel editing
              </Button>
            ) : null}
          </div>
        </form>

        <div className="mt-10 flex items-center justify-between gap-4">
          <h2 className="font-serif text-lg tracking-tight">Your pronunciations</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              Import…
            </Button>
            <Button size="sm" variant="ghost" disabled={!entries?.length} onClick={exportJson}>
              Export
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Import pronunciations"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importJson(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {!entries ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : !entries.length ? (
          <div className="mt-3">
            <EmptyState
              icon={<Type size={24} aria-hidden />}
              title="No custom pronunciations yet"
              body="Add a word and how it should sound above, then press Test to hear it in the current voice."
            />
          </div>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-[13px] text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 font-normal">
                  Written as
                </th>
                <th scope="col" className="py-2 font-normal">
                  Say it as
                </th>
                <th scope="col" className="py-2 font-normal">
                  Voices
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries
                .toSorted((a, b) => a.match.localeCompare(b.match))
                .map((e) => (
                  <tr key={e.id}>
                    <th
                      scope="row"
                      className="max-w-40 py-2 pr-3 text-left font-normal break-words"
                    >
                      {e.match}
                    </th>
                    <td className="max-w-48 py-2 pr-3 break-words text-ink-2">{e.say}</td>
                    <td className="py-2 pr-3 text-[13px] text-muted">{engineLabel(e)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Test ${e.match}`}
                        onClick={() => void test(e)}
                      >
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${e.match}`}
                        onClick={() =>
                          setDraft({
                            id: e.id,
                            match: e.match,
                            say: e.say,
                            engine: e.engines?.[0] ?? 'all',
                            caseSensitive: !!e.caseSensitive,
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${e.match}`}
                        onClick={() =>
                          void lexicon.remove(e.id).then(async () => {
                            await changed();
                            toast({
                              kind: 'info',
                              title: `Deleted “${e.match}”`,
                              action: {
                                label: 'Undo',
                                onClick: () => void lexicon.put(e).then(changed),
                              },
                            });
                          })
                        }
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
