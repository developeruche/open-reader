import { useState, type ReactNode } from 'react';
import {
  Ban,
  Cpu,
  Gauge,
  Globe,
  HardDrive,
  Info,
  Keyboard,
  Mic,
  Stethoscope,
  Type,
} from '../icons';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Kbd,
  Progress,
  Select,
  SkipLink,
  Slider,
  Toggle,
  toast,
} from '../components';
import { cn } from '../cn';
import { formatRate } from '../format';
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

const MODELS = [
  {
    name: 'Kokoro 82M',
    detail: 'Natural · native word timing · 326 MB',
    state: 'Installed',
    badge: 'Default',
  },
  {
    name: 'Piper Classic (lessac high)',
    detail: 'Fast · research-use data · 114 MB',
    state: 'Installed',
  },
  {
    name: 'Piper lessac medium',
    detail: 'Fastest · research-use data · 63 MB',
    state: 'Not installed',
  },
  { name: 'System voices', detail: 'No download · quality varies', state: 'Available' },
];

function Voices() {
  return (
    <Section
      title="Voices & models"
      intro="Everything runs on this device once a model is downloaded."
    >
      <p className="mb-4 flex items-center gap-2 text-sm">
        <Cpu size={16} aria-hidden /> Benchmark: Kokoro · WebGPU · 9.4× real time
      </p>
      <ul className="divide-y divide-line border-y border-line">
        {MODELS.map((m) => (
          <li key={m.name} className="flex items-center gap-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {m.name} {m.badge ? <Badge tone="solid">{m.badge}</Badge> : null}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">{m.detail}</p>
            </div>
            <span className="text-[13px] text-ink-2">{m.state}</span>
            <Button size="sm" variant={m.state === 'Not installed' ? 'primary' : 'secondary'}>
              {m.state === 'Not installed' ? 'Install' : 'Manage'}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Playback() {
  const [rate, setRate] = useState(1);
  const [pacing, setPacing] = useState('natural');
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
      />
      <div className="mt-8">
        <Select
          label="Pauses between sentences and paragraphs"
          value={pacing}
          onValueChange={setPacing}
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
  const [r, setR] = useState({
    code: true,
    tables: true,
    citations: true,
    urls: true,
    refs: true,
    headers: true,
  });
  const row = (k: keyof typeof r, label: string, description?: string) => (
    <Toggle
      label={label}
      description={description}
      checked={r[k]}
      onCheckedChange={(v) => setR({ ...r, [k]: v })}
    />
  );
  return (
    <Section
      title="Reading rules"
      intro="What the voice passes over. Skipped text stays on screen."
    >
      <div className="divide-y divide-line border-y border-line">
        {row('code', 'Skip code blocks', 'Says “Code block skipped” once.')}
        {row('tables', 'Skip tables')}
        {row('citations', 'Skip bracketed citations like [12]')}
        {row('urls', 'Skip bare links')}
        {row('refs', 'Skip references and bibliography')}
        {row('headers', 'Skip PDF headers, footers and page numbers')}
      </div>
    </Section>
  );
}

function Pronunciations() {
  return (
    <Section title="Pronunciations" intro="Teach the voice how to say names and terms.">
      <EmptyState
        icon={<Type size={24} aria-hidden />}
        title="No custom pronunciations yet"
        body="Add a word and how it should sound, then press Test to hear it in the current voice."
        action={<Button variant="primary">Add pronunciation</Button>}
      />
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

function Storage() {
  return (
    <Section title="Storage" intro="Models and documents live in this browser profile.">
      <div className="flex items-baseline justify-between text-sm">
        <span>Used</span>
        <span className="tabular">512 MB of 262 GB</span>
      </div>
      <Progress className="mt-2" label="Storage used" value={0.002} />
      <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
        {[
          ['Models', '440 MB'],
          ['Audio cache', '68 MB of 512 MB'],
          ['Documents', '4 MB'],
          ['Persistent storage', 'Granted'],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between py-3">
            <dt>{k}</dt>
            <dd className="text-ink-2 tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <Button
        className="mt-6"
        onClick={() => toast({ kind: 'success', title: 'Audio cache cleared' })}
      >
        Clear audio cache
      </Button>
    </Section>
  );
}

function Diagnostics() {
  return (
    <Section title="Diagnostics" intro="Live engine stats and a log without any document text.">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
        {[
          ['Backend', 'WebGPU'],
          ['Real-time factor', '0.11'],
          ['Buffer ahead', '24 s'],
          ['Cache hit rate', '38%'],
          ['Errors', 'None'],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[13px] text-muted">{k}</dt>
            <dd className="mt-0.5 text-lg tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <Button className="mt-8" onClick={() => toast({ kind: 'info', title: 'Diagnostics copied' })}>
        Copy diagnostics
      </Button>
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
  voices: Voices,
  playback: Playback,
  rules: Rules,
  pronunciations: Pronunciations,
  online: Online,
  shortcuts: Shortcuts,
  storage: Storage,
  diagnostics: Diagnostics,
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
