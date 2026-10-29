import { useEffect, useState } from 'react';
import type { TtsVoice } from '@/engines/system/tts';
import { chromeTts } from '@/platform/tts';
import { loadSettings, saveSettings } from '@/platform/settings';
import { Badge, Button, EmptyState, Toggle } from '../components';
import { Volume2 } from '../icons';

/** System voices (chrome.tts): the zero-download fallback. Online voices are labelled (§6.5). */
export function SystemVoices({
  currentVoice,
  onChange,
}: {
  currentVoice: string | null;
  onChange(): void;
}) {
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [strict, setStrict] = useState(true);

  useEffect(() => {
    void chromeTts()
      .getVoices()
      .then((v) => setVoices(v.filter((x) => !x.lang || x.lang.startsWith('en'))))
      .catch(() => setVoices([]));
    void loadSettings().then((s) => setStrict(s.strictOffline));
  }, []);

  const shown = (voices ?? []).filter((v) => !strict || !v.remote);
  return (
    <section aria-labelledby="system-voices" className="mt-10">
      <h2 id="system-voices" className="font-serif text-xl tracking-tight">
        System voices
      </h2>
      <p className="mt-1 text-[13px] text-muted">
        Built into your computer. No download; quality varies.
      </p>
      <div className="mt-2 border-y border-line">
        <Toggle
          label="Strict offline"
          description="Hide voices that send text to an online service."
          checked={strict}
          onCheckedChange={(v) => {
            setStrict(v);
            void saveSettings({ strictOffline: v });
          }}
        />
      </div>
      {voices && shown.length === 0 ? (
        <EmptyState
          icon={<Volume2 size={24} aria-hidden />}
          title="No system voices found"
          body="Your system did not report any English voices."
        />
      ) : (
        <ul className="divide-y divide-line" aria-label="System voices">
          {shown.map((v) => {
            const isDefault = currentVoice === v.voiceName;
            return (
              <li key={v.voiceName} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 text-sm">
                  {v.voiceName} <span className="text-muted">· {v.lang}</span>
                </span>
                {v.remote ? <Badge>Online</Badge> : null}
                {isDefault ? (
                  <Badge tone="solid">Default</Badge>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      void saveSettings({ voice: { engineId: 'system', voice: v.voiceName } }).then(
                        onChange,
                      )
                    }
                  >
                    Set as default
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
