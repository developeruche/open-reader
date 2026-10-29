import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/core/settings';
import type { DiagnosticsReport } from '@/runtime/orchestrator';
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
const cache = {
  size: vi.fn(async () => 68e6),
  clear: vi.fn(async () => undefined),
  setCap: vi.fn(async () => undefined),
};
vi.mock('@/platform/audioCache', () => ({
  IdbSynthesisCache: class {
    size = cache.size;
    clear = cache.clear;
    setCap = cache.setCap;
  },
}));
const clearDocuments = vi.fn(async () => undefined);
vi.mock('@/platform/documents', () => ({
  documentsSize: async () => 4e6,
  clearDocuments: () => clearDocuments(),
}));
const requestPersistence = vi.fn(async () => false);
vi.mock('@/platform/opfs', () => ({
  storageStatus: async () => ({ usage: 512e6, quota: 262e9, persisted: false }),
  requestPersistence: () => requestPersistence(),
}));
vi.mock('@/platform/kv', () => ({
  localStore: () => ({
    get: async () => ({
      k: {
        modelId: 'k',
        version: '1',
        backend: 'any',
        installedAt: 0,
        files: [{ path: 'a', bytes: 440e6, sha256: '' }],
      },
    }),
  }),
}));
vi.mock('@/platform/environment', () => ({
  environmentInfo: async () => ({
    version: '0.2.0',
    userAgent: 'UA',
    cores: 16,
    memoryGB: 8,
    webgpu: { vendor: 'apple', architecture: 'metal-3' },
    crossOriginIsolated: false,
  }),
}));
let report: DiagnosticsReport | null = null;
vi.mock('@/ui/session/useDiagnostics', () => ({ useDiagnostics: () => report }));

const { StorageSection } = await import('@/ui/shells/StorageSection');
const { DiagnosticsSection } = await import('@/ui/shells/DiagnosticsSection');

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
  report = null;
});

describe('StorageSection', () => {
  it('shows real usage, changes the cache cap and clears stores', async () => {
    wrap(<StorageSection />);
    expect(await screen.findByText('440 MB')).toBeTruthy();
    expect(screen.getByText('68 MB of 512 MB')).toBeTruthy();
    expect(screen.getByText('4 MB')).toBeTruthy();
    expect(screen.getByText('512 MB of 262 GB')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Clear audio cache' }));
    expect(cache.clear).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove stored PDFs' }));
    expect(clearDocuments).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove PDFs' }));
    expect(clearDocuments).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Request' }));
    expect(requestPersistence).toHaveBeenCalled();
    expect(await screen.findByText('Chrome did not grant persistent storage')).toBeTruthy();

    await userEvent.click(screen.getByRole('combobox', { name: 'Audio cache limit' }));
    await userEvent.click(await screen.findByRole('option', { name: '1 GB' }));
    expect(saved).toContainEqual({ cacheCapMB: 1024 });
    await vi.waitFor(() => expect(cache.setCap).toHaveBeenCalledWith(1024 * 1024 * 1024));
  });
});

describe('DiagnosticsSection', () => {
  it('asks to start reading when there are no stats, and shows the device', async () => {
    wrap(<DiagnosticsSection />);
    expect(screen.getByText('Start reading to see live numbers.')).toBeTruthy();
    expect(await screen.findByText(/16 cores · 8 GB · WebGPU \(apple metal-3\)/)).toBeTruthy();
    expect(screen.getByText('No events yet.')).toBeTruthy();
  });

  it('shows live stats and the log, toggles the overlay and copies JSON without secrets', async () => {
    report = {
      session: null,
      droppedLogEntries: 0,
      stats: [
        {
          sessionId: 's',
          host: 'offscreen',
          engine: 'kokoro',
          backend: 'webgpu',
          state: 'playing',
          rtf: 0.112,
          synthesized: 6,
          cacheHits: 2,
          bufferAhead: 23.6,
          stalls: 0,
          errors: 1,
          fallbacks: 1,
          engineRestarts: 0,
          at: 5,
        },
      ],
      log: [
        { at: 1, level: 'info', source: 'ui', message: 'command PLAY' },
        { at: 2, level: 'error', source: 'offscreen', message: 'state error', detail: 'boom' },
      ],
    };
    settings = { ...settings, onlineKey: 'sk-secret' } as Settings;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    wrap(<DiagnosticsSection />);
    expect(screen.getByText('kokoro · webgpu')).toBeTruthy();
    expect(screen.getByText('0.11')).toBeTruthy();
    expect(screen.getByText('24 s')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    const log = screen.getByRole('list', { name: 'Diagnostics log' });
    expect(within(log).getAllByRole('listitem')[0]?.textContent).toContain('boom');

    await userEvent.click(await screen.findByRole('switch', { name: /Reading order overlay/ }));
    expect(saved).toContainEqual({ readingOrderOverlay: true });

    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    const json = String((writeText.mock.calls as unknown as string[][])[0]?.[0]);
    expect(JSON.parse(json)).toMatchObject({ report: { stats: [{ engine: 'kokoro' }] } });
    expect(json).toContain('[redacted]');
    expect(json).not.toContain('sk-secret');
    expect(await screen.findByText('Diagnostics copied')).toBeTruthy();
  });
});
