import { useEffect, useState } from 'react';
import { Library, Play } from '../icons';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Kbd,
  Progress,
  Select,
  Skeleton,
  Slider,
  Tabs,
  Toggle,
  toast,
} from '../components';
import { useMockPlayer } from '../mock/mockPlayer';
import { MiniPlayer, mountMiniPlayer } from './MiniPlayer';

/** Test-only page: every component in one place, plus the mini player in a closed shadow root. */
export function GalleryApp() {
  const [toggle, setToggle] = useState(true);
  const [slider, setSlider] = useState(1.25);
  const [sel, setSel] = useState('natural');
  const p = useMockPlayer();

  useEffect(() => {
    const { root, host } = mountMiniPlayer();
    host.setAttribute('data-testid', 'mini-player-host');
    const render = () => {
      const s = useMockPlayer.getState();
      root.render(
        <MiniPlayer
          playing={s.status === 'playing'}
          rate={s.rate}
          followSuspended={!s.follow}
          onToggle={s.toggle}
          onRate={s.setRate}
          onJump={() => s.setFollow(true)}
        />,
      );
    };
    render();
    const unsub = useMockPlayer.subscribe(render);
    return () => {
      unsub();
      setTimeout(() => {
        root.unmount();
        host.remove();
      });
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-10 bg-paper px-8 py-10 text-ink">
      <h1 className="font-serif text-3xl tracking-tight">Components</h1>
      <section aria-label="Buttons" className="flex flex-wrap items-center gap-3">
        <Button variant="primary">Install</Button>
        <Button>Cancel</Button>
        <Button variant="ghost">Skip</Button>
        <IconButton label="Play">
          <Play size={18} aria-hidden />
        </IconButton>
        <Badge>Apache-2.0</Badge>
        <Badge tone="solid">Default</Badge>
        <Kbd>Space</Kbd>
      </section>
      <section aria-label="Inputs" className="max-w-sm space-y-4">
        <Toggle label="Follow the voice" checked={toggle} onCheckedChange={setToggle} />
        <Slider
          label="Speed"
          min={0.5}
          max={4}
          step={0.05}
          value={slider}
          onValueChange={setSlider}
        />
        <Select
          label="Pacing"
          value={sel}
          onValueChange={setSel}
          options={[
            { value: 'brisk', label: 'Brisk' },
            { value: 'natural', label: 'Natural' },
          ]}
        />
        <Progress label="Download" value={0.4} />
        <Skeleton className="h-4 w-48" />
      </section>
      <section aria-label="Tabs">
        <Tabs
          label="Example"
          items={[
            { value: 'a', label: 'Reader', content: <p className="p-4">Reader</p> },
            { value: 'b', label: 'Outline', content: <p className="p-4">Outline</p> },
          ]}
        />
      </section>
      <section aria-label="Overlays" className="flex gap-3">
        <Dialog
          trigger={<Button>Open dialog</Button>}
          title="Remove model?"
          description="Kokoro 82M will be deleted. You can download it again."
          footer={<Button variant="primary">Remove</Button>}
        />
        <Button
          onClick={() =>
            toast({
              kind: 'error',
              title: 'WebGPU failed',
              description: 'Switched to Piper.',
              action: { label: 'Details', onClick: () => undefined },
            })
          }
        >
          Show error toast
        </Button>
      </section>
      <EmptyState
        icon={<Library size={24} aria-hidden />}
        title="No documents yet"
        body="PDFs you open appear here so you can resume them offline."
      />
      <p className="text-sm text-muted">Mini player status: {p.status}</p>
    </main>
  );
}
