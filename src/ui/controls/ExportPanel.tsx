/** Audiobook export control (PLAN.md M11): format choice, progress with cancel, and the result. */
import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '@/platform/settings';
import type { ExportFormat, ExportStatus } from '@/runtime/protocol';
import { Button, Dialog, Progress, Select } from '../components';

const FORMATS = [
  { value: 'mp3', label: 'MP3', hint: '64 kbps, chapters' },
  { value: 'wav', label: 'WAV', hint: 'Lossless, large' },
];

export function ExportPanel({
  job,
  disabled,
  onStart,
  onCancel,
}: {
  job: ExportStatus | null | undefined;
  /** Why export is unavailable (shown instead of the button), e.g. system voices. */
  disabled?: string;
  onStart(format: ExportFormat): void;
  onCancel(): void;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('mp3');
  useEffect(() => {
    void loadSettings().then((s) => setFormat(s.exportFormat));
  }, []);
  const running = job?.state === 'running';

  return (
    <section aria-labelledby="export-title" className="flex flex-col gap-2">
      <h2 id="export-title" className="text-[13px] text-muted">
        Audiobook
      </h2>
      {running ? (
        <div className="flex flex-col gap-2" role="status">
          <Progress
            label={job.phase === 'render' ? 'Rendering speech' : 'Encoding audio'}
            value={job.fraction}
          />
          <div className="flex items-center justify-between text-[13px] text-ink-2">
            <span className="tabular">
              {job.phase === 'render' ? 'Rendering speech…' : 'Encoding…'}{' '}
              {Math.round(job.fraction * 100)}%
            </span>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel export
            </Button>
          </div>
        </div>
      ) : (
        <>
          {disabled ? (
            <p className="text-[13px] text-ink-2">{disabled}</p>
          ) : (
            <Button size="sm" onClick={() => setOpen(true)}>
              Export audiobook…
            </Button>
          )}
          {job?.state === 'done' ? (
            <p className="text-[13px] text-ink-2" role="status">
              Saved “{job.filename}” to Downloads.
            </p>
          ) : job?.state === 'error' ? (
            <p className="text-[13px] text-ink" role="alert">
              <strong className="font-semibold">Export failed.</strong> {job.message}
            </p>
          ) : job?.state === 'cancelled' ? (
            <p className="text-[13px] text-ink-2" role="status">
              Export cancelled.
            </p>
          ) : null}
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Export as an audiobook"
        description="The whole document with the current voice, pauses and reading rules, at normal speed. Headings become chapters. It keeps running if you close this panel."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                void saveSettings({ exportFormat: format });
                onStart(format);
              }}
            >
              Start export
            </Button>
          </>
        }
      >
        <Select
          label="Format"
          value={format}
          options={FORMATS}
          onValueChange={(v) => setFormat(v as ExportFormat)}
        />
      </Dialog>
    </section>
  );
}
