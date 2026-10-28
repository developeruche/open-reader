import { useCallback, useEffect } from 'react';
import { FileText, MoreHorizontal, Settings, SkipBack, SkipForward } from '../icons';
import { IconButton, Menu, Tabs, Toggle, Select, SkipLink } from '../components';
import { EngineStatus } from '../controls/EngineStatus';
import { PlayButton } from '../controls/PlayButton';
import { SpeedControl } from '../controls/SpeedControl';
import { VoiceControl } from '../controls/VoiceControl';
import { formatTimeLeft } from '../format';
import { MOCK_DOC, MOCK_SENTENCES } from '../mock/mockDocument';
import { mockTimeLeft, useMockPlayer } from '../mock/mockPlayer';
import { ReadingView } from '../reading/ReadingView';
import type { useAppearanceHook } from './types';
import { useTransportKeys } from './useTransportKeys';

export function SidePanelApp({ useAppearance }: { useAppearance: useAppearanceHook }) {
  const p = useMockPlayer();
  const { theme, setTheme } = useAppearance();
  useTransportKeys();
  const onSeek = useCallback((i: number) => useMockPlayer.getState().seek(i), []);
  useEffect(() => () => useMockPlayer.getState().pause(), []);

  const headings = MOCK_DOC.blocks
    .map((b, bi) => ({
      b,
      first: MOCK_DOC.blocks.slice(0, bi).reduce((n, x) => n + x.sentences.length, 0),
    }))
    .filter((x) => x.b.type === 'heading');

  return (
    <div className="flex h-screen min-w-[320px] flex-col bg-paper text-ink">
      <SkipLink />
      <header className="flex items-start gap-2 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 font-serif text-[19px] leading-tight tracking-[-0.015em] text-balance">
            {MOCK_DOC.title}
          </h1>
          <p className="mt-1 text-xs text-muted">{MOCK_DOC.site}</p>
        </div>
        <Menu
          trigger={
            <IconButton label="More" size="sm">
              <MoreHorizontal size={18} aria-hidden />
            </IconButton>
          }
          items={[
            {
              label: 'Open a PDF…',
              icon: <FileText size={16} aria-hidden />,
              onSelect: () => undefined,
            },
            {
              label: 'Settings',
              icon: <Settings size={16} aria-hidden />,
              onSelect: () => undefined,
            },
          ]}
        />
      </header>

      <section aria-label="Playback" className="border-y border-line px-4 py-4">
        <div className="flex items-center justify-center gap-3">
          <IconButton label="Previous sentence" shortcut="J" onClick={p.prev}>
            <SkipBack size={20} aria-hidden />
          </IconButton>
          <PlayButton playing={p.status === 'playing'} onToggle={p.toggle} />
          <IconButton label="Next sentence" shortcut="K" onClick={p.next}>
            <SkipForward size={20} aria-hidden />
          </IconButton>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <SpeedControl rate={p.rate} onRateChange={p.setRate} />
          <VoiceControl voice={p.voice} onVoiceChange={p.setVoice} />
        </div>
        <div className="mt-4">
          <div
            className="h-0.5 w-full rounded-full bg-line"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={1}
            aria-valuemax={MOCK_SENTENCES.length}
            aria-valuenow={p.sentence + 1}
            aria-valuetext={`Sentence ${p.sentence + 1} of ${MOCK_SENTENCES.length}`}
          >
            <div
              className="h-full w-full origin-left rounded-full bg-ink transition-transform duration-(--dur)"
              style={{ transform: `scaleX(${(p.sentence + 1) / MOCK_SENTENCES.length})` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted tabular">
            <span>
              Sentence {p.sentence + 1} of {MOCK_SENTENCES.length}
            </span>
            <span>{formatTimeLeft(mockTimeLeft(p.sentence, p.word, p.rate))}</span>
          </div>
        </div>
      </section>

      <main id="content" className="flex min-h-0 flex-1 flex-col">
        <Tabs
          label="Views"
          className="flex-1"
          panelClassName="overflow-y-auto"
          items={[
            {
              value: 'reader',
              label: 'Reader',
              content: (
                <ReadingView
                  className="mx-auto max-w-[66ch] px-5 pb-16"
                  blocks={MOCK_DOC.blocks}
                  sentence={p.sentence}
                  word={p.word}
                  active={p.status !== 'idle'}
                  follow={p.follow}
                  onSeek={onSeek}
                />
              ),
            },
            {
              value: 'outline',
              label: 'Outline',
              content: (
                <nav aria-label="Outline" className="px-2 py-3">
                  <ul>
                    {headings.map(({ b, first }) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => p.seek(first)}
                          className="w-full rounded-control px-3 py-2 text-left font-serif text-[15px] hover:bg-hover"
                          style={{ paddingLeft: 12 + ((b.level ?? 1) - 1) * 16 }}
                        >
                          {b.sentences[0]?.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              ),
            },
            {
              value: 'settings',
              label: 'Settings',
              content: (
                <div className="flex flex-col gap-2 px-4 py-4">
                  <Toggle
                    label="Follow the voice"
                    description="Keep the current sentence in view."
                    checked={p.follow}
                    onCheckedChange={p.setFollow}
                  />
                  <Select
                    label="Theme"
                    value={theme}
                    onValueChange={(v) => setTheme(v as typeof theme)}
                    options={[
                      { value: 'system', label: 'Match system' },
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </main>

      <footer className="border-t border-line px-4 py-2.5">
        <EngineStatus state="ready" text="On-device · Kokoro · WebGPU" />
      </footer>
    </div>
  );
}
