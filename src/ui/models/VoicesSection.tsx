import { useState } from 'react';
import type { ModelManifest } from '@/core/tts/registry';
import { filesFor } from '@/core/models/manager';
import { Cpu } from '../icons';
import { Badge, Button, Dialog, Progress } from '../components';
import { useModels } from './useModels';

const mb = (b: number) => `${Math.round(b / 1e6)} MB`;

export function VoicesSection() {
  const m = useModels();
  const [confirm, setConfirm] = useState<ModelManifest | null>(null);

  const start = (model: ModelManifest) => {
    if (model.license.notice || model.license.personalUseOnly) setConfirm(model);
    else void m.install(model);
  };

  return (
    <section aria-labelledby="section-title" className="max-w-2xl">
      <h1
        id="section-title"
        className="font-serif text-[30px] leading-tight tracking-[-0.02em] text-balance"
      >
        Voices & models
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        Everything runs on this device once a model is downloaded.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
        <Cpu size={16} aria-hidden />
        <span aria-live="polite">
          {m.benchmarking
            ? 'Checking this computer…'
            : m.benchmarkText
              ? `Benchmark: ${m.benchmarkText}`
              : 'No benchmark yet.'}
        </span>
        <Button
          size="sm"
          onClick={() => void m.benchmark()}
          disabled={m.benchmarking || !Object.keys(m.installed).length}
        >
          Run benchmark
        </Button>
        <span className="text-muted">
          {m.gpu ? 'WebGPU available' : 'No WebGPU: models run on the CPU'}
        </span>
      </div>

      <ul className="mt-6 divide-y divide-line border-y border-line" aria-label="Models">
        {m.models.map((model) => {
          const inst = m.installed[model.id];
          const job = m.jobs[model.id];
          const isDefault = m.voice?.modelId === model.id;
          return (
            <li key={model.id} className="py-4" data-model={model.id}>
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {model.displayName}
                    {isDefault ? <Badge tone="solid">Default</Badge> : null}
                    {model.license.personalUseOnly ? <Badge>Personal use only</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {model.engine === 'kokoro'
                      ? 'Natural · word timing from the model'
                      : 'Fast · estimated word timing'}{' '}
                    ·{' '}
                    {mb(
                      filesFor(model, m.gpu ? 'webgpu' : 'wasm').reduce((a, f) => a + f.bytes, 0),
                    )}{' '}
                    · {model.license.spdx}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {job?.state === 'downloading' ? (
                    <>
                      <Button size="sm" onClick={() => m.pause(model.id)}>
                        Pause
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void m.cancel(model)}>
                        Cancel
                      </Button>
                    </>
                  ) : job?.state === 'paused' || job?.state === 'error' ? (
                    <>
                      <Button size="sm" variant="primary" onClick={() => void m.install(model)}>
                        {job.state === 'paused' ? 'Resume' : 'Retry'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void m.cancel(model)}>
                        Cancel
                      </Button>
                    </>
                  ) : inst ? (
                    <>
                      {!isDefault ? (
                        <Button
                          size="sm"
                          onClick={() => void m.setDefault(model, model.defaultVoice)}
                        >
                          Set as default
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void m.repair(model)}
                        disabled={job?.state === 'repairing'}
                      >
                        {job?.state === 'repairing' ? 'Checking…' : 'Repair'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void m.remove(model)}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="primary" onClick={() => start(model)}>
                      Install
                    </Button>
                  )}
                </div>
              </div>
              {job ? (
                <div className="mt-3">
                  <Progress
                    label={`${model.displayName} download`}
                    value={job.total ? job.loaded / job.total : null}
                  />
                  <p className="mt-1 text-[13px] text-muted tabular" aria-live="polite">
                    {job.state === 'error' ? (
                      <>
                        <strong className="font-semibold text-ink">Error:</strong> {job.error} Press
                        Retry to continue where it stopped.
                      </>
                    ) : job.state === 'paused' ? (
                      'Paused. Resume continues where it stopped.'
                    ) : (
                      `${mb(job.loaded)} of ${mb(job.total)}`
                    )}
                  </p>
                </div>
              ) : null}
              {inst && model.voices.length > 1 ? (
                <fieldset className="mt-3">
                  <legend className="text-[13px] text-muted">Voice</legend>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {model.voices.map((v) => (
                      <Button
                        key={v.id}
                        size="sm"
                        variant={isDefault && m.voice?.voice === v.id ? 'primary' : 'secondary'}
                        aria-pressed={isDefault && m.voice?.voice === v.id}
                        onClick={() => void m.setDefault(model, v.id)}
                      >
                        {v.name}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Install ${confirm?.displayName ?? ''}?`}
        description={confirm?.license.notice ?? 'This model has license conditions.'}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirm) void m.install(confirm);
                setConfirm(null);
              }}
            >
              Install for personal use
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          {confirm ? mb(confirm.sizeBytes) : ''} from huggingface.co, checked with SHA-256. License:{' '}
          {confirm?.license.spdx}.
        </p>
      </Dialog>
    </section>
  );
}
