/** Diagnostics (PLAN.md §9.2): live engine numbers, the log and a JSON export without document text. */
import { useEffect, useState } from 'react';
import { redactSecrets, type LogEntry } from '@/core/diagnostics/log';
import type { Settings } from '@/core/settings';
import { environmentInfo, type EnvironmentInfo } from '@/platform/environment';
import { loadSettings, saveSettings } from '@/platform/settings';
import type { HostStats } from '@/runtime/protocol';
import { Button, Toggle, toast } from '../components';
import { cn } from '../cn';
import { useDiagnostics } from '../session/useDiagnostics';

export function DiagnosticsSection() {
  const report = useDiagnostics();
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void environmentInfo().then(setEnv);
    void loadSettings().then(setSettings);
  }, []);
  const stats = report?.stats.toSorted((a, b) => b.at - a.at)[0];

  const copy = async () => {
    const json = JSON.stringify(
      redactSecrets({ generatedAt: new Date().toISOString(), environment: env, settings, report }),
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(json);
      toast({ kind: 'success', title: 'Diagnostics copied', description: 'No document text.' });
    } catch {
      toast({ kind: 'error', title: 'Could not copy to the clipboard' });
    }
  };

  return (
    <section aria-labelledby="section-title" className="max-w-2xl">
      <h1
        id="section-title"
        className="font-serif text-[30px] leading-tight tracking-[-0.02em] text-balance"
      >
        Diagnostics
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        Live engine numbers and a log of events. Nothing here contains document text.
      </p>
      <div className="mt-8">
        {stats ? (
          <StatsGrid stats={stats} />
        ) : (
          <p className="text-sm text-muted">Start reading to see live numbers.</p>
        )}
        {env ? (
          <p className="mt-6 text-[13px] text-muted">
            Version {env.version} · {env.cores} cores
            {env.memoryGB ? ` · ${env.memoryGB} GB` : ''} ·{' '}
            {env.webgpu
              ? `WebGPU (${[env.webgpu.vendor, env.webgpu.architecture].filter(Boolean).join(' ') || 'available'})`
              : 'No WebGPU'}
          </p>
        ) : null}
        <div className="mt-6 divide-y divide-line border-y border-line">
          <Toggle
            label="Reading order overlay for PDFs"
            description="Numbers each block in the order it is read when a PDF opens."
            checked={settings?.readingOrderOverlay ?? false}
            disabled={!settings}
            onCheckedChange={(v) => void saveSettings({ readingOrderOverlay: v }).then(setSettings)}
          />
        </div>
        <Button className="mt-6" onClick={() => void copy()}>
          Copy diagnostics
        </Button>
        <h2 className="mt-10 font-serif text-lg tracking-tight">Log</h2>
        <Log entries={report?.log ?? []} />
      </div>
    </section>
  );
}

function StatsGrid({ stats }: { stats: HostStats }) {
  const lookups = stats.cacheHits + stats.synthesized;
  const items: [string, string][] = [
    ['State', stats.state],
    ['Engine', [stats.engine, stats.backend].filter(Boolean).join(' · ') || '—'],
    ['Real-time factor', stats.rtf === null ? '—' : stats.rtf.toFixed(2)],
    ['Buffer ahead', `${Math.round(stats.bufferAhead)} s`],
    ['Cache hit rate', lookups ? `${Math.round((stats.cacheHits / lookups) * 100)}%` : '—'],
    ['Stalls', String(stats.stalls)],
    ['Errors', String(stats.errors)],
    ['Engine switches', String(stats.fallbacks + stats.engineRestarts)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[13px] text-muted">{k}</dt>
          <dd className="mt-0.5 text-lg tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour12: false, timeStyle: 'medium' });

function Log({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) return <p className="mt-3 text-sm text-muted">No events yet.</p>;
  return (
    <ol
      aria-label="Diagnostics log"
      className="mt-3 max-h-96 divide-y divide-line overflow-auto border-y border-line font-mono text-xs"
    >
      {entries
        .slice(-200)
        .reverse()
        .map((e, i) => (
          <li
            key={`${e.at}-${i}`}
            className="flex gap-3 py-1.5 [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
          >
            <span className="shrink-0 text-muted tabular">{time(e.at)}</span>
            <span
              className={cn(
                'w-10 shrink-0 text-ink-2',
                // Monochrome design system (ADR 0009): weight, not color, marks errors.
                e.level === 'error' && 'font-semibold text-ink',
              )}
            >
              {e.level}
            </span>
            <span className="w-16 shrink-0 text-muted">{e.source}</span>
            <span className="min-w-0 break-words">
              {e.message}
              {e.detail ? <span className="block text-muted">{e.detail}</span> : null}
            </span>
          </li>
        ))}
    </ol>
  );
}
