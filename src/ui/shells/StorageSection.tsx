/** Storage (PLAN.md §4.4, §9.2): what lives where, the audio cache cap and clearing. */
import { useEffect, useState } from 'react';
import { INSTALLED_KEY, type InstalledIndex } from '@/core/models/manager';
import { IdbSynthesisCache } from '@/platform/audioCache';
import { clearDocuments, documentsSize } from '@/platform/documents';
import { localStore } from '@/platform/kv';
import { requestPersistence, storageStatus } from '@/platform/opfs';
import { loadSettings, saveSettings } from '@/platform/settings';
import { Button, Dialog, Progress, Select, Skeleton, toast } from '../components';
import { formatBytes } from '../format';

const CAPS = [256, 512, 1024, 2048, 4096].map((mb) => ({
  value: String(mb),
  label: mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`,
}));

interface Numbers {
  usage: number;
  quota: number;
  persisted: boolean;
  models: number;
  audio: number;
  documents: number;
  capMB: number;
}

async function measure(): Promise<Numbers> {
  const [status, audio, documents, installed, settings] = await Promise.all([
    storageStatus(),
    new IdbSynthesisCache().size(),
    documentsSize(),
    localStore().get<InstalledIndex>(INSTALLED_KEY),
    loadSettings(),
  ]);
  const models = Object.values(installed ?? {})
    .flatMap((m) => m.files)
    .reduce((a, f) => a + f.bytes, 0);
  return { ...status, audio, documents, models, capMB: settings.cacheCapMB };
}

export function StorageSection() {
  const [n, setN] = useState<Numbers | null>(null);
  const [confirmDocs, setConfirmDocs] = useState(false);
  const refresh = () => measure().then(setN);
  useEffect(() => {
    void measure().then(setN);
  }, []);

  const clearAudio = async () => {
    await new IdbSynthesisCache().clear();
    toast({ kind: 'success', title: 'Audio cache cleared' });
    await refresh();
  };
  const clearDocs = async () => {
    setConfirmDocs(false);
    await clearDocuments();
    toast({
      kind: 'success',
      title: 'Stored PDFs removed',
      description: 'Reading positions are kept; open a file again to read it.',
    });
    await refresh();
  };

  return (
    <section aria-labelledby="section-title" className="max-w-2xl">
      <h1
        id="section-title"
        className="font-serif text-[30px] leading-tight tracking-[-0.02em] text-balance"
      >
        Storage
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        Models, cached audio and opened PDFs live in this browser profile.
      </p>
      <div className="mt-8">
        {!n ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span>Used</span>
              <span className="tabular">
                {formatBytes(n.usage)} of {formatBytes(n.quota)}
              </span>
            </div>
            <Progress
              className="mt-2"
              label="Storage used"
              value={n.quota ? n.usage / n.quota : 0}
            />
            <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
              <Row k="Models" v={formatBytes(n.models)} />
              <Row
                k="Audio cache"
                v={`${formatBytes(n.audio)} of ${CAPS.find((c) => c.value === String(n.capMB))?.label ?? `${n.capMB} MB`}`}
              />
              <Row k="Documents" v={formatBytes(n.documents)} />
              <div className="flex items-center justify-between py-3">
                <dt>Persistent storage</dt>
                <dd className="text-ink-2">
                  {n.persisted ? (
                    'Granted'
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void requestPersistence().then((ok) => {
                          if (!ok)
                            toast({
                              kind: 'info',
                              title: 'Chrome did not grant persistent storage',
                              description:
                                'It decides from how often you use the extension; models stay unless space runs out.',
                            });
                          return refresh();
                        })
                      }
                    >
                      Request
                    </Button>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex items-end gap-4">
              <Select
                label="Audio cache limit"
                value={String(n.capMB)}
                options={CAPS}
                onValueChange={(v) =>
                  void saveSettings({ cacheCapMB: Number(v) })
                    .then(() => new IdbSynthesisCache().setCap(Number(v) * 1024 * 1024))
                    .then(() => refresh())
                }
              />
            </div>
            <p className="mt-2 text-[13px] text-muted">
              Least recently played audio is removed first when the cache is full.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => void clearAudio()}>Clear audio cache</Button>
              <Button variant="ghost" onClick={() => setConfirmDocs(true)}>
                Remove stored PDFs
              </Button>
            </div>
          </>
        )}
      </div>
      <Dialog
        open={confirmDocs}
        onOpenChange={setConfirmDocs}
        title="Remove stored PDFs?"
        description="Recent documents will need their files opened again. Reading positions are kept."
        footer={
          <>
            <Button onClick={() => setConfirmDocs(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void clearDocs()}>
              Remove PDFs
            </Button>
          </>
        }
      />
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-3">
      <dt>{k}</dt>
      <dd className="text-ink-2 tabular">{v}</dd>
    </div>
  );
}
