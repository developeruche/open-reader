import { useEffect, useState, type ReactNode } from 'react';
import type { Settings } from '@/core/settings';
import type { SkipRules } from '@/core/text/skip';
import { loadSettings, saveSettings } from '@/platform/settings';
import { Ban, Gauge, Globe, HardDrive, Info, Keyboard, Mic, Stethoscope, Type } from '../icons';
import { Button, Dialog, Kbd, Select, Skeleton, SkipLink, Slider, Toggle } from '../components';
import { cn } from '../cn';
import { formatRate } from '../format';
import { VoicesSection } from '../models/VoicesSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { PronunciationsSection } from './PronunciationsSection';
import { StorageSection } from './StorageSection';
import type { useAppearanceHook } from './types';

type SectionId =
  | 'voices'
  | 'playback'
  | 'rules'
  | 'pronunciations'
  | 'online'
  | 'shortcuts'
  | 'storage'
  | 'diagnostics'
  | 'about';

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: 'voices', label: 'Voices & models', icon: <Mic size={16} aria-hidden /> },
  { id: 'playback', label: 'Playback', icon: <Gauge size={16} aria-hidden /> },
  { id: 'rules', label: 'Reading rules', icon: <Ban size={16} aria-hidden /> },
  { id: 'pronunciations', label: 'Pronunciations', icon: <Type size={16} aria-hidden /> },
  { id: 'online', label: 'Online voices', icon: <Globe size={16} aria-hidden /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={16} aria-hidden /> },
  { id: 'storage', label: 'Storage', icon: <HardDrive size={16} aria-hidden /> },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Stethoscope size={16} aria-hidden /> },
  { id: 'about', label: 'About & licenses', icon: <Info size={16} aria-hidden /> },
];

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="section-title" className="max-w-2xl">
      <h1
        id="section-title"
        className="font-serif text-[30px] leading-tight tracking-[-0.02em] text-balance"
      >
        {title}
      </h1>
      {intro ? <p className="mt-2 text-sm text-ink-2">{intro}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Playback() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    void loadSettings().then((x) => {
      setSettings(x);
      setRate(x.rate);
    });
  }, []);
  if (!settings)
    return (
      <Section title="Playback" intro="Defaults for new reading sessions.">
        <Skeleton className="h-28 w-full" />
      </Section>
    );
  return (
    <Section title="Playback" intro="Defaults for new reading sessions.">
      <div className="flex items-baseline justify-between">
        <span className="text-sm">Default speed</span>
        <span className="text-sm tabular">{formatRate(rate)}</span>
      </div>
      <Slider
        className="mt-3"
        label="Default speed"
        min={0.5}
        max={4}
        step={0.05}
        value={rate}
        onValueChange={setRate}
        onValueCommit={(v) => void saveSettings({ rate: v }).then(setSettings)}
      />
      <p className="mt-2 text-[13px] text-muted">
        Above 2× the voice speaks faster too, so speech stays clear.
      </p>
      <div className="mt-8">
        <Select
          label="Pauses between sentences and paragraphs"
          value={settings.pacing}
          onValueChange={(v) =>
            void saveSettings({ pacing: v as Settings['pacing'] }).then(setSettings)
          }
          options={[
            { value: 'brisk', label: 'Brisk', hint: '0.6×' },
            { value: 'natural', label: 'Natural', hint: '1.0×' },
            { value: 'relaxed', label: 'Relaxed', hint: '1.4×' },
          ]}
        />
      </div>
    </Section>
  );
}

function Rules() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);
  if (!settings)
    return (
      <Section
        title="Reading rules"
        intro="What the voice passes over. Skipped text stays on screen."
      >
        <Skeleton className="h-40 w-full" />
      </Section>
    );
  const r = settings.skipRules;
  const update = (patch: Partial<Settings>) => void saveSettings(patch).then(setSettings);
  const rule = (k: keyof SkipRules, label: string, description?: string, on: string = 'skip') => (
    <Toggle
      label={label}
      description={description}
      checked={r[k] === on}
      onCheckedChange={(v) =>
        update({ skipRules: { ...r, [k]: v ? on : on === 'skip' ? 'read' : 'skip' } as SkipRules })
      }
    />
  );
  return (
    <Section
      title="Reading rules"
      intro="What the voice passes over. Skipped text stays on screen."
    >
      <div className="divide-y divide-line border-y border-line">
        {rule('codeBlocks', 'Skip code blocks')}
        <Toggle
          label="Announce skipped code"
          description="Says “Code block skipped” once."
          checked={r.announceSkippedCode}
          onCheckedChange={(v) => update({ skipRules: { ...r, announceSkippedCode: v } })}
        />
        {rule('tables', 'Skip tables', 'Off reads them row by row.')}
        {rule('citations', 'Skip bracketed citations like [12]')}
        {rule('urls', 'Skip bare links', 'Off says “link to example dot com”.')}
        {rule('references', 'Skip references and bibliography')}
        {rule('headersFooters', 'Skip PDF headers, footers and page numbers')}
        {rule('captions', 'Skip figure captions')}
      </div>
      <h2 className="mt-10 font-serif text-xl tracking-tight">PDF links</h2>
      <div className="mt-2 border-y border-line">
        <Toggle
          label="Open PDF links in Open Reader"
          description="Instead of Chrome's PDF viewer. Off by default."
          checked={settings.interceptPdf}
          onCheckedChange={(v) => update({ interceptPdf: v })}
        />
      </div>
    </Section>
  );
}

function Online() {
  const [on, setOn] = useState(false);
  return (
    <Section
      title="Online voices"
      intro="Off by default. When on, the current and next sentence are sent to the provider you choose."
    >
      <Dialog
        open={on}
        onOpenChange={setOn}
        title="Send text to an online voice?"
        description="Text you play will leave this device and go to the provider. Your key stays on this device and is never synced."
        footer={
          <>
            <Button onClick={() => setOn(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOn(false)}>
              Turn on
            </Button>
          </>
        }
      />
      <div className="border-y border-line">
        <Toggle
          label="Use online voices"
          description="Requires your own API key."
          checked={false}
          onCheckedChange={setOn}
        />
      </div>
    </Section>
  );
}

const SHORTCUTS: [string, string[]][] = [
  ['Open Open Reader', ['Alt', 'Shift', 'O']],
  ['Play or pause (anywhere)', ['Alt', 'Shift', 'P']],
  ['Next sentence (anywhere)', ['Alt', 'Shift', '.']],
  ['Previous sentence (anywhere)', ['Alt', 'Shift', ',']],
  ['Play or pause', ['Space']],
  ['Previous / next sentence', ['J', 'K']],
  ['Previous / next paragraph', ['Shift', 'J']],
  ['Slower / faster', ['−', '=']],
  ['Follow on or off', ['F']],
  ['Stop', ['Esc']],
];

function Shortcuts() {
  return (
    <Section
      title="Shortcuts"
      intro="The first four work in any tab. Change them at chrome://extensions/shortcuts."
    >
      <table className="w-full text-sm">
        <caption className="visually-hidden">Keyboard shortcuts</caption>
        <tbody className="divide-y divide-line">
          {SHORTCUTS.map(([label, keys]) => (
            <tr key={label}>
              <th scope="row" className="py-3 text-left font-normal">
                {label}
              </th>
              <td className="py-3 text-right">
                <span className="inline-flex gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function About() {
  return (
    <Section title="About & licenses" intro="Open Reader is for research and personal use.">
      <p className="text-sm text-ink-2">
        Version 0.2.0. Third-party licenses are listed in docs/THIRD_PARTY.md and docs/MODELS.md.
      </p>
    </Section>
  );
}

const VIEWS: Record<SectionId, () => ReactNode> = {
  voices: VoicesSection,
  playback: Playback,
  rules: Rules,
  pronunciations: PronunciationsSection,
  online: Online,
  shortcuts: Shortcuts,
  storage: StorageSection,
  diagnostics: DiagnosticsSection,
  about: About,
};

export function OptionsApp({ useAppearance }: { useAppearance: useAppearanceHook }) {
  const [section, setSection] = useState<SectionId>(() => {
    const h = location.hash.slice(1) as SectionId;
    return h in VIEWS ? h : 'voices';
  });
  const { theme, setTheme } = useAppearance();
  const View = VIEWS[section];
  return (
    <div className="flex min-h-screen bg-paper text-ink">
      <SkipLink />
      <nav
        aria-label="Settings"
        className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line px-3 py-6"
      >
        <p translate="no" className="px-3 font-serif text-xl tracking-tight">
          Open Reader
        </p>
        <ul className="mt-6 flex flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={s.id === section ? 'page' : undefined}
                onClick={() => setSection(s.id)}
                className={cn(
                  'flex h-9 items-center gap-3 rounded-control px-3 text-sm text-ink-2 transition-quiet hover:bg-hover',
                  s.id === section && 'bg-paper-2 font-medium text-ink',
                )}
              >
                {s.icon}
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-auto px-3">
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
      </nav>
      <main id="content" className="min-w-0 flex-1 px-12 py-12">
        <View />
      </main>
    </div>
  );
}
