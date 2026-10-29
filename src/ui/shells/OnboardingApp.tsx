import { useState } from 'react';
import { Check, Play } from '../icons';
import { Badge, Button, Kbd, Progress } from '../components';
import { cn } from '../cn';
import { useModels } from '../models/useModels';
import { ReadingDemo } from '../reading/ReadingDemo';
import { playSample } from '@/runtime/models';
import { saveSettings } from '@/platform/settings';

const STEPS = ['Welcome', 'Download', 'Benchmark', 'Voice', 'Shortcuts', 'Done'] as const;
const mb = (b: number) => `${Math.round(b / 1e6)} MB`;

export function OnboardingApp() {
  const [step, setStep] = useState(0);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const m = useModels();
  const kokoro = m.models.find((x) => x.engine === 'kokoro');
  const installed = !!(kokoro && m.installed[kokoro.id]);
  const job = kokoro ? m.jobs[kokoro.id] : undefined;
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const blocked = (step === 1 && !installed) || (step === 2 && m.benchmarking);

  return (
    <div className="flex min-h-screen flex-col items-center bg-paper px-6 py-16 text-ink">
      <ol aria-label="Setup steps" className="flex gap-2">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className="flex items-center gap-2 text-xs text-muted aria-[current=step]:text-ink"
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-[11px] tabular',
                i < step
                  ? 'border-ink bg-ink text-paper'
                  : i === step
                    ? 'border-ink'
                    : 'border-line',
              )}
            >
              {i < step ? <Check size={12} aria-hidden /> : i + 1}
            </span>
            <span className={i === step ? '' : 'sr-only sm:not-sr-only'}>{s}</span>
          </li>
        ))}
      </ol>

      <main className="mt-16 w-full max-w-xl">
        {step === 0 ? (
          <>
            <h1 className="font-serif text-[44px] leading-[1.05] tracking-[-0.03em] text-balance">
              Listen to anything you would read.
            </h1>
            <p className="mt-4 text-[17px] text-ink-2">
              Open Reader reads web pages and PDFs aloud with a voice that runs on this computer.
            </p>
            <div className="mt-10 border-y border-line py-8">
              <ReadingDemo />
            </div>
          </>
        ) : null}

        {step === 1 && kokoro ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">
              Download {kokoro.displayName}
            </h1>
            <p className="mt-2 text-ink-2">
              {mb(
                m.gpu
                  ? kokoro.files
                      .filter((f) => f.backend !== 'wasm')
                      .reduce((a, f) => a + f.bytes, 0)
                  : kokoro.files
                      .filter((f) => f.backend !== 'webgpu')
                      .reduce((a, f) => a + f.bytes, 0),
              )}
              , once. After this, reading works with the network off.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm">
              <Badge>{kokoro.license.spdx}</Badge>{' '}
              <span className="text-muted">huggingface.co · checked with SHA-256</span>
            </div>
            {installed ? (
              <p className="mt-6 flex items-center gap-2 text-sm" role="status">
                <Check size={16} aria-hidden /> Downloaded and verified.
              </p>
            ) : job ? (
              <>
                <Progress
                  className="mt-6"
                  label="Download progress"
                  value={job.total ? job.loaded / job.total : null}
                />
                <p className="mt-2 text-[13px] text-muted tabular" aria-live="polite">
                  {job.state === 'error' ? (
                    <>
                      <strong className="font-semibold text-ink">Error:</strong> {job.error}
                    </>
                  ) : job.state === 'paused' ? (
                    'Paused.'
                  ) : (
                    `${mb(job.loaded)} of ${mb(job.total)}`
                  )}
                </p>
                <div className="mt-3 flex gap-2">
                  {job.state === 'downloading' ? (
                    <Button size="sm" onClick={() => m.pause(kokoro.id)}>
                      Pause
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => void m.install(kokoro)}>
                      {job.state === 'paused' ? 'Resume' : 'Retry'}
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <Button className="mt-6" variant="primary" onClick={() => void m.install(kokoro)}>
                Download
              </Button>
            )}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">Check this computer</h1>
            <p className="mt-2 text-ink-2">
              About ten seconds to pick the fastest way to run the voice.
            </p>
            <p className="mt-6 text-sm" aria-live="polite">
              {m.benchmarking
                ? 'Measuring…'
                : m.benchmarkText
                  ? `Result: ${m.benchmarkText}`
                  : m.gpu
                    ? 'WebGPU is available.'
                    : 'No WebGPU: the voice runs on the CPU.'}
            </p>
            {!m.benchmarking && !m.benchmarkText ? (
              <Button className="mt-4" onClick={() => void m.benchmark()} disabled={!installed}>
                Run the check
              </Button>
            ) : null}
          </>
        ) : null}

        {step === 3 && kokoro ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">Pick a voice</h1>
            <p className="mt-2 text-ink-2">
              Play a short sample of each. You can change this any time.
            </p>
            <div
              role="radiogroup"
              aria-label="Voice"
              className="mt-6 divide-y divide-line border-y border-line"
            >
              {kokoro.voices.map((v) => {
                const selected = (m.voice?.voice ?? kokoro.defaultVoice) === v.id;
                return (
                  <div key={v.id} className="flex items-center gap-3 py-3">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => void m.setDefault(kokoro, v.id)}
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      <span className="flex size-4 items-center justify-center rounded-full border border-ink">
                        {selected ? <span className="size-2 rounded-full bg-ink" /> : null}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{v.name}</span>
                        <span className="block text-[13px] text-muted">
                          Kokoro · {v.lang === 'en-GB' ? 'UK' : 'US'} English
                        </span>
                      </span>
                    </button>
                    <Button
                      size="sm"
                      aria-label={`Play sample of ${v.name}`}
                      disabled={!installed}
                      onClick={() => {
                        setSampleError(null);
                        playSample(
                          kokoro,
                          v.id,
                          m.voice?.backend ?? (m.gpu ? 'webgpu' : 'wasm'),
                        ).catch((e: unknown) =>
                          setSampleError(e instanceof Error ? e.message : String(e)),
                        );
                      }}
                    >
                      <Play size={14} aria-hidden /> Sample
                    </Button>
                  </div>
                );
              })}
            </div>
            {sampleError ? (
              <p className="mt-3 text-sm" role="alert">
                <strong className="font-semibold">Error:</strong> {sampleError}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">Three keys to remember</h1>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="flex items-center justify-between">
                Open Open Reader{' '}
                <span className="flex gap-1">
                  <Kbd>Alt</Kbd>
                  <Kbd>Shift</Kbd>
                  <Kbd>O</Kbd>
                </span>
              </li>
              <li className="flex items-center justify-between">
                Play or pause in any tab{' '}
                <span className="flex gap-1">
                  <Kbd>Alt</Kbd>
                  <Kbd>Shift</Kbd>
                  <Kbd>P</Kbd>
                </span>
              </li>
              <li className="flex items-center justify-between">
                Read from a word <span className="text-muted">Alt + click</span>
              </li>
            </ul>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">Ready</h1>
            <p className="mt-2 text-ink-2">
              Open any article and press Alt+Shift+O, or right-click it and choose Read page from
              here.
            </p>
          </>
        ) : null}

        <div className="mt-12 flex justify-between">
          {step > 0 ? <Button onClick={back}>Back</Button> : <span />}
          <Button
            variant="primary"
            disabled={blocked}
            onClick={() => {
              if (step === STEPS.length - 1)
                void saveSettings({ onboarded: true }).then(() => window.close());
              else next();
            }}
          >
            {step === 0 ? 'Get started' : step === STEPS.length - 1 ? 'Finish' : 'Continue'}
          </Button>
        </div>
      </main>
    </div>
  );
}
