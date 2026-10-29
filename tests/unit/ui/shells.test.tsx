import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStore } from '@/core/util/kv';
import { REGISTRY } from '@/engines/factory';
import { Toaster, TooltipProvider } from '@/ui/components';
import { useMockPlayer } from '@/ui/mock/mockPlayer';
import { createAppearanceStore } from '@/ui/theme';

const models = {
  install: vi.fn(),
  pause: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  repair: vi.fn(),
  setDefault: vi.fn(),
  benchmark: vi.fn(),
};
let modelState: Record<string, unknown> = {};
vi.mock('@/ui/models/useModels', () => ({
  useModels: () => ({
    models: REGISTRY.models,
    installed: {},
    jobs: {},
    report: null,
    benchmarkText: null,
    benchmarking: false,
    voice: null,
    gpu: true,
    ...models,
    ...modelState,
  }),
}));
vi.mock('@/runtime/models', () => ({ playSample: vi.fn(async () => undefined) }));
vi.mock('@/platform/settings', () => ({ saveSettings: vi.fn(async () => ({})) }));

const { SidePanelApp } = await import('@/ui/shells/SidePanelApp');
const { ReaderApp } = await import('@/ui/shells/ReaderApp');
const { OptionsApp } = await import('@/ui/shells/OptionsApp');
const { OnboardingApp } = await import('@/ui/shells/OnboardingApp');
const { GalleryApp } = await import('@/ui/shells/GalleryApp');

const wrap = (ui: React.ReactNode) =>
  render(
    <TooltipProvider>
      {ui}
      <Toaster />
    </TooltipProvider>,
  );
const appearance = () => createAppearanceStore(memoryStore());

beforeEach(() => {
  location.hash = '';
  useMockPlayer.setState({ status: 'idle', sentence: 0, word: 0, rate: 1, follow: true });
  modelState = {};
  Object.values(models).forEach((f) => f.mockReset());
});

describe('SidePanelApp', () => {
  it('plays, skips and switches tabs', async () => {
    wrap(<SidePanelApp useAppearance={appearance()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(useMockPlayer.getState().status).toBe('playing');
    await userEvent.click(screen.getByRole('button', { name: 'Next sentence' }));
    expect(useMockPlayer.getState().sentence).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Previous sentence' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Outline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Why hardware wallets like it' }));
    expect(useMockPlayer.getState().sentence).toBeGreaterThan(5);
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Follow the voice' }));
    expect(useMockPlayer.getState().follow).toBe(false);
    act(() => useMockPlayer.getState().pause());
  });

  it('opens the speed and voice popovers', async () => {
    wrap(<SidePanelApp useAppearance={appearance()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Speed 1.0×' }));
    await userEvent.click(screen.getByRole('button', { name: '1.5×' }));
    expect(useMockPlayer.getState().rate).toBe(1.5);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /Voice:/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Emma/ }));
    expect(useMockPlayer.getState().voice).toBe('bf_emma');
  });
});

describe('ReaderApp', () => {
  it('pages, zooms and toggles drawers', async () => {
    wrap(<ReaderApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 / 3')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide pages and outline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show reading rules' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Skip figure captions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(useMockPlayer.getState().follow).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    act(() => useMockPlayer.getState().pause());
  });
});

describe('OptionsApp', () => {
  it('navigates every section', async () => {
    wrap(<OptionsApp useAppearance={appearance()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Voices & models' })).toBeTruthy();
    for (const name of [
      'Playback',
      'Reading rules',
      'Pronunciations',
      'Online voices',
      'Shortcuts',
      'Storage',
      'Diagnostics',
      'About & licenses',
    ]) {
      await userEvent.click(screen.getByRole('link', { name }));
      expect(screen.getByRole('heading', { level: 1, name })).toBeTruthy();
    }
    await userEvent.click(screen.getByRole('link', { name: 'Storage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear audio cache' }));
    await userEvent.click(screen.getByRole('link', { name: 'Online voices' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Use online voices' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  });

  it('installs models, confirming license notices', async () => {
    wrap(<OptionsApp useAppearance={appearance()} />);
    const items = screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-model'));
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Install' }));
    expect(models.install).toHaveBeenCalledWith(expect.objectContaining({ engine: 'kokoro' }));
    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Install' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Install for personal use' }));
    expect(models.install).toHaveBeenCalledTimes(2);
  });

  it('shows download progress and installed actions', async () => {
    const kokoro = REGISTRY.models[0]!;
    modelState = {
      installed: {
        [kokoro.id]: {
          modelId: kokoro.id,
          version: kokoro.version,
          backend: 'webgpu',
          files: [],
          installedAt: 0,
        },
      },
      jobs: {
        [REGISTRY.models[1]!.id]: { state: 'downloading', loaded: 5e6, total: 1e8 },
        [REGISTRY.models[2]!.id]: { state: 'error', loaded: 0, total: 1, error: 'Offline.' },
      },
      voice: { engineId: 'kokoro', modelId: kokoro.id, voice: 'af_heart' },
      benchmarkText: 'Kokoro · WebGPU · 9.4× real time',
    };
    wrap(<OptionsApp useAppearance={appearance()} />);
    expect(screen.getByText(/Benchmark: Kokoro/)).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(models.pause).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Repair' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Emma' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run benchmark' }));
    expect(models.repair).toHaveBeenCalled();
    expect(models.remove).toHaveBeenCalled();
    expect(models.setDefault).toHaveBeenCalledWith(kokoro, 'bf_emma');
    expect(models.benchmark).toHaveBeenCalled();
  });
});

describe('OnboardingApp', () => {
  it('walks through download, benchmark, voice and shortcuts', async () => {
    wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(models.install).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
  });

  it('continues once installed and plays samples', async () => {
    const kokoro = REGISTRY.models[0]!;
    modelState = {
      installed: {
        [kokoro.id]: {
          modelId: kokoro.id,
          version: kokoro.version,
          backend: 'wasm',
          files: [],
          installedAt: 0,
        },
      },
    };
    wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.getByText('Downloaded and verified.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run the check' }));
    expect(models.benchmark).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play sample of Emma' }));
    await userEvent.click(screen.getByRole('radio', { name: /George/ }));
    expect(models.setDefault).toHaveBeenCalledWith(kokoro, 'bm_george');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Three keys to remember' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeTruthy();
  });

  it('shows paused and failed downloads with a way to continue', async () => {
    const kokoro = REGISTRY.models[0]!;
    modelState = { jobs: { [kokoro.id]: { state: 'paused', loaded: 1, total: 2 } } };
    const { unmount } = wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    unmount();
    modelState = { jobs: { [kokoro.id]: { state: 'downloading', loaded: 1, total: 2 } } };
    wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(models.pause).toHaveBeenCalled();
  });
});

describe('GalleryApp', () => {
  it('renders components and the mini player', async () => {
    wrap(<GalleryApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Show error toast' }));
    expect(await screen.findByText('WebGPU failed')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
