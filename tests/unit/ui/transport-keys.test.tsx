import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMockPlayer } from '@/ui/mock/mockPlayer';
import { useTransportKeys } from '@/ui/shells/useTransportKeys';

function Harness() {
  useTransportKeys();
  return <input aria-label="search" />;
}

describe('in-page shortcuts', () => {
  beforeEach(() =>
    useMockPlayer.setState({ status: 'idle', sentence: 3, word: 0, rate: 1, follow: true }),
  );
  afterEach(() => useMockPlayer.getState().pause());

  it('maps J/K, −/=, F, Space and Esc', async () => {
    render(<Harness />);
    await userEvent.keyboard('k');
    expect(useMockPlayer.getState().sentence).toBe(4);
    await userEvent.keyboard('jj');
    expect(useMockPlayer.getState().sentence).toBe(2);
    await userEvent.keyboard('==');
    expect(useMockPlayer.getState().rate).toBe(1.5);
    await userEvent.keyboard('-');
    expect(useMockPlayer.getState().rate).toBe(1.25);
    await userEvent.keyboard('f');
    expect(useMockPlayer.getState().follow).toBe(false);
    await userEvent.keyboard(' ');
    expect(useMockPlayer.getState().status).toBe('playing');
    await userEvent.keyboard('{Escape}');
    expect(useMockPlayer.getState().status).toBe('paused');
  });

  it('ignores keys while typing', async () => {
    const { getByLabelText } = render(<Harness />);
    await userEvent.click(getByLabelText('search'));
    await userEvent.keyboard('k ');
    expect(useMockPlayer.getState().sentence).toBe(3);
    expect(useMockPlayer.getState().status).toBe('idle');
  });

  it('clamps speed to 0.5–4×', async () => {
    useMockPlayer.setState({ rate: 3.9 });
    render(<Harness />);
    await userEvent.keyboard('==');
    expect(useMockPlayer.getState().rate).toBe(4);
  });
});
