import { useState } from 'react';
import { Check, Play } from '../icons';
import { Badge, Button, Kbd, Progress } from '../components';
import { cn } from '../cn';
import { MOCK_VOICES } from '../mock/mockDocument';
import { ReadingDemo } from '../reading/ReadingDemo';

const STEPS = ['Welcome', 'Voice', 'Download', 'Benchmark', 'Shortcuts', 'Done'] as const;

export function OnboardingApp() {
  const [step, setStep] = useState(0);
  const [voice, setVoice] = useState('af_heart');
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

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
        {step === 1 ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">Pick a voice</h1>
            <p className="mt-2 text-ink-2">
              Play a ten-second sample of each. You can change this any time.
            </p>
            <div
              role="radiogroup"
              aria-label="Voice"
              className="mt-6 divide-y divide-line border-y border-line"
            >
              {MOCK_VOICES.map((v) => (
                <div key={v.id} className="flex items-center gap-3 py-3">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={voice === v.id}
                    onClick={() => setVoice(v.id)}
                    className="flex flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded-full border border-ink',
                      )}
                    >
                      {voice === v.id ? <span className="size-2 rounded-full bg-ink" /> : null}
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{v.name}</span>
                      <span className="block text-[13px] text-muted">{v.detail}</span>
                    </span>
                  </button>
                  <Button size="sm" aria-label={`Play sample of ${v.name}`}>
                    <Play size={14} aria-hidden /> Sample
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">Download Kokoro 82M</h1>
            <p className="mt-2 text-ink-2">
              326 MB, once. After this, reading works with the network off.
            </p>
            <div className="mt-6 flex items-center gap-2 text-sm">
              <Badge>Apache-2.0</Badge>{' '}
              <span className="text-muted">huggingface.co · checked with SHA-256</span>
            </div>
            <Progress className="mt-6" label="Download progress" value={0.42} />
            <p className="mt-2 text-[13px] text-muted tabular">137 of 326 MB</p>
          </>
        ) : null}
        {step === 3 ? (
          <>
            <h1 className="font-serif text-3xl tracking-[-0.02em]">Checking this computer</h1>
            <p className="mt-2 text-ink-2">Ten seconds to pick the fastest way to run the voice.</p>
            <p className="mt-6 text-sm">Kokoro · WebGPU · 9.4× real time</p>
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
              Open any article and press Alt+Shift+O, or open a PDF here.
            </p>
          </>
        ) : null}

        <div className="mt-12 flex justify-between">
          {step > 0 ? <Button onClick={back}>Back</Button> : <span />}
          <Button variant="primary" onClick={next} disabled={step === STEPS.length - 1}>
            {step === 0 ? 'Get started' : step === STEPS.length - 1 ? 'Finish' : 'Continue'}
          </Button>
        </div>
      </main>
    </div>
  );
}
