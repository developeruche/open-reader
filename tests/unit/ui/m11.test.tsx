import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/core/settings';
import type { StoredEntry } from '@/core/text/lexicon';
import { DEFAULT_SKIP_RULES } from '@/core/text/skip';
import { Toaster, TooltipProvider } from '@/ui/components';

let settings: Settings = { ...DEFAULT_SETTINGS };
const saved: Partial<Settings>[] = [];
vi.mock('@/platform/settings', () => ({
  loadSettings: async () => settings,
  saveSettings: async (p: Partial<Settings>) => {
    saved.push(p);
    settings = { ...settings, ...p };
    return settings;
  },
}));
let store = new Map<string, StoredEntry>();
vi.mock('@/platform/lexicon', () => ({
  IdbLexicon: class {
    list = async () => [...store.values()];
    put = async (e: StoredEntry) => void store.set(e.id, e);
    remove = async (id: string) => void store.delete(id);
    replaceAll = async (es: StoredEntry[]) => void (store = new Map(es.map((e) => [e.id, e])));
  },
}));
const testPronunciation = vi.fn(async (e: StoredEntry) => `Say ${e.say}.`);
vi.mock('@/runtime/models', () => ({
  testPronunciation: (e: StoredEntry) => testPronunciation(e),
}));
vi.mock('@/platform/tts', () => ({ chromeTts: () => ({ speak: vi.fn() }) }));

const { PronunciationsSection } = await import('@/ui/shells/PronunciationsSection');
const { ExportPanel } = await import('@/ui/controls/ExportPanel');
const { SleepTimerSelect } = await import('@/ui/controls/SleepTimer');
const { DocRules, WEB_RULES } = await import('@/ui/controls/DocRules');

const wrap = (ui: React.ReactNode) =>
  render(
    <TooltipProvider>
      {ui}
      <Toaster />
    </TooltipProvider>,
  );

beforeEach(() => {
  settings = { ...DEFAULT_SETTINGS };
  saved.length = 0;
  store = new Map();
  testPronunciation.mockClear();
});

describe('PronunciationsSection', () => {
  it('adds, tests, edits and deletes entries, bumping the lexicon revision', async () => {
    wrap(<PronunciationsSection />);
    expect(await screen.findByText('No custom pronunciations yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add pronunciation' }));
    expect(screen.getByText('Enter the word as it is written.')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Written as'), 'Schnorr');
    await userEvent.type(screen.getByLabelText('Say it as'), 'shnor');
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(testPronunciation).toHaveBeenCalledWith(
      expect.objectContaining({ match: 'Schnorr', say: 'shnor' }),
    );
    expect(await screen.findByText('The voice says: “Say shnor.”')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add pronunciation' }));
    const row = await screen.findByRole('row', { name: /Schnorr/ });
    expect(within(row).getByText('shnor')).toBeTruthy();
    expect(saved).toContainEqual({ lexiconRevision: 1 });

    // A duplicate spelling is refused.
    await userEvent.type(screen.getByLabelText('Written as'), 'schnorr');
    await userEvent.type(screen.getByLabelText('Say it as'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Add pronunciation' }));
    expect(screen.getByText(/already has a pronunciation/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Written as'));
    await userEvent.clear(screen.getByLabelText('Say it as'));

    await userEvent.click(screen.getByRole('button', { name: 'Edit Schnorr' }));
    expect((screen.getByLabelText('Say it as') as HTMLInputElement).value).toBe('shnor');
    await userEvent.clear(screen.getByLabelText('Say it as'));
    await userEvent.type(screen.getByLabelText('Say it as'), 'shnorr');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('shnorr')).toBeTruthy();
    expect(store.size).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Test Schnorr' }));
    expect(testPronunciation).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Schnorr' }));
    expect(await screen.findByText('No custom pronunciations yet')).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('row', { name: /Schnorr/ })).toBeTruthy();
  }, 15_000);

  it('turns packs off and on', async () => {
    wrap(<PronunciationsSection />);
    const pack = await screen.findByRole('switch', { name: /Bitcoin and Ethereum/ });
    await userEvent.click(pack);
    expect(saved.at(-1)).toMatchObject({ packs: ['programming'] });
    await userEvent.click(pack);
    expect(saved.at(-1)?.packs).toEqual(['programming', 'bitcoin']);
  });

  it('imports a pronunciation file and rejects anything else', async () => {
    wrap(<PronunciationsSection />);
    await screen.findByText('No custom pronunciations yet');
    const input = screen.getByLabelText('Import pronunciations');
    const good = new File(
      [
        JSON.stringify({
          format: 'open-reader-lexicon',
          version: 1,
          entries: [{ match: 'nginx', say: 'engine X' }],
        }),
      ],
      'p.json',
      { type: 'application/json' },
    );
    await userEvent.upload(input, good);
    expect(await screen.findByText('Imported 1 pronunciations')).toBeTruthy();
    expect(await screen.findByRole('row', { name: /nginx/ })).toBeTruthy();
    await userEvent.upload(
      input,
      new File(['{"nope":1}'], 'bad.json', { type: 'application/json' }),
    );
    expect(
      await screen.findByText('That file is not an Open Reader pronunciation list'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });
});

describe('ExportPanel', () => {
  it('starts an export in the chosen format and shows progress, result and errors', async () => {
    const onStart = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = wrap(<ExportPanel job={null} onStart={onStart} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export audiobook…' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Format' }));
    await userEvent.click(await screen.findByRole('option', { name: /WAV/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start export' }));
    expect(onStart).toHaveBeenCalledWith('wav');
    expect(saved).toContainEqual({ exportFormat: 'wav' });

    const running = {
      jobId: 'j',
      format: 'wav' as const,
      state: 'running' as const,
      phase: 'render' as const,
      fraction: 0.42,
    };
    rerender(
      <TooltipProvider>
        <ExportPanel job={running} onStart={onStart} onCancel={onCancel} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/Rendering speech… 42%/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(onCancel).toHaveBeenCalled();
    rerender(
      <TooltipProvider>
        <ExportPanel
          job={{ ...running, state: 'done', filename: 'Doc.wav' }}
          onStart={onStart}
          onCancel={onCancel}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('Saved “Doc.wav” to Downloads.')).toBeTruthy();
    rerender(
      <TooltipProvider>
        <ExportPanel
          job={{ ...running, state: 'error', message: 'Disk full.' }}
          onStart={onStart}
          onCancel={onCancel}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Disk full.');
    rerender(
      <TooltipProvider>
        <ExportPanel
          job={null}
          disabled="System voices can’t be saved."
          onStart={onStart}
          onCancel={onCancel}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Export audiobook…' })).toBeNull();
  });
});

describe('SleepTimerSelect and DocRules', () => {
  it('offers minutes and end of section, and shows a running timer', async () => {
    const onChange = vi.fn();
    const { rerender } = wrap(<SleepTimerSelect value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Sleep timer' }));
    await userEvent.click(await screen.findByRole('option', { name: '15 minutes' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'minutes', minutes: 15 });
    await userEvent.click(screen.getByRole('combobox', { name: 'Sleep timer' }));
    await userEvent.click(await screen.findByRole('option', { name: 'End of section' }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'section' });
    rerender(
      <SleepTimerSelect value={{ kind: 'minutes', at: Date.now() + 60_000 }} onChange={onChange} />,
    );
    expect(screen.getByRole('combobox', { name: 'Sleep timer' }).textContent).toMatch(/Until/);
    await userEvent.click(screen.getByRole('combobox', { name: 'Sleep timer' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('toggles rules for one document and returns to the defaults', async () => {
    const onChange = vi.fn();
    wrap(<DocRules rules={DEFAULT_SKIP_RULES} custom keys={WEB_RULES} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Skip code blocks' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_SKIP_RULES, codeBlocks: 'read' });
    await userEvent.click(screen.getByRole('switch', { name: 'Skip web addresses' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SKIP_RULES, urls: 'say' });
    await userEvent.click(screen.getByRole('button', { name: 'Use my default rules' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
