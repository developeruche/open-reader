import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MiniPlayer, mountMiniPlayer } from '@/ui/shells/MiniPlayer';

describe('MiniPlayer', () => {
  it('mounts in a closed shadow root that the page cannot reach', () => {
    const { root, host, shadow } = mountMiniPlayer();
    act(() =>
      root.render(
        <MiniPlayer
          playing={false}
          rate={1}
          followSuspended={false}
          onToggle={() => undefined}
          onRate={() => undefined}
          onJump={() => undefined}
        />,
      ),
    );
    expect(host.shadowRoot).toBeNull();
    expect(shadow.querySelector('[role=toolbar]')?.getAttribute('aria-label')).toBe('Open Reader');
    expect(shadow.querySelector('style')?.textContent).toContain(':host');
    act(() => root.unmount());
    host.remove();
  });

  it('cycles speed and shows "Resume follow" when following is suspended', () => {
    const onRate = vi.fn();
    const { root, host, shadow } = mountMiniPlayer();
    act(() =>
      root.render(
        <MiniPlayer
          playing
          rate={1.5}
          followSuspended
          onToggle={() => undefined}
          onRate={onRate}
          onJump={() => undefined}
        />,
      ),
    );
    const buttons = [...shadow.querySelectorAll('button')];
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Pause');
    act(() => buttons[1]?.click());
    expect(onRate).toHaveBeenCalledWith(2);
    expect(buttons[2]?.textContent).toContain('Resume follow');
    act(() => root.unmount());
    host.remove();
  });
});
