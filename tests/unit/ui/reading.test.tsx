import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_DOC, MOCK_SENTENCES } from '@/ui/mock/mockDocument';
import { mockTimeLeft, useMockPlayer } from '@/ui/mock/mockPlayer';
import { ReadingView } from '@/ui/reading/ReadingView';

describe('ReadingView', () => {
  it('marks the current sentence and ink-inverts the current word', () => {
    const s = MOCK_SENTENCES[1]!;
    render(
      <ReadingView
        blocks={MOCK_DOC.blocks}
        sentence={1}
        word={2}
        active
        follow={false}
        onSeek={() => undefined}
      />,
    );
    const current = document.querySelector('[data-current-sentence]');
    expect(current?.textContent?.trim()).toBe(s.text);
    const w = s.words[2]!;
    expect(document.querySelector('[data-current-word]')?.textContent).toBe(
      s.text.slice(w.start, w.end),
    );
  });

  it('seeks when a sentence is clicked', () => {
    const onSeek = vi.fn();
    render(
      <ReadingView
        blocks={MOCK_DOC.blocks}
        sentence={0}
        word={0}
        active={false}
        follow={false}
        onSeek={onSeek}
      />,
    );
    const target = screen.getByText(MOCK_SENTENCES[3]!.text, { exact: false });
    target.click();
    expect(onSeek).toHaveBeenCalledWith(3);
  });

  it('shows no word highlight when idle', () => {
    render(
      <ReadingView
        blocks={MOCK_DOC.blocks}
        sentence={0}
        word={0}
        active={false}
        follow={false}
        onSeek={() => undefined}
      />,
    );
    expect(document.querySelector('[data-current-word]')).toBeNull();
  });
});

describe('mock player', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMockPlayer.setState({ status: 'idle', sentence: 0, word: 0, rate: 1 });
  });
  afterEach(() => {
    useMockPlayer.getState().pause();
    vi.useRealTimers();
  });

  it('advances words while playing and stops when paused', () => {
    act(() => useMockPlayer.getState().toggle());
    act(() => vi.advanceTimersByTime(280 * 3 + 10));
    expect(useMockPlayer.getState().word).toBe(3);
    act(() => useMockPlayer.getState().toggle());
    act(() => vi.advanceTimersByTime(2000));
    expect(useMockPlayer.getState().word).toBe(3);
    expect(useMockPlayer.getState().status).toBe('paused');
  });

  it('plays faster at a higher rate and clamps navigation', () => {
    useMockPlayer.getState().setRate(2);
    act(() => useMockPlayer.getState().toggle());
    act(() => vi.advanceTimersByTime(140 * 4 + 10));
    expect(useMockPlayer.getState().word).toBe(4);
    useMockPlayer.getState().prev();
    expect(useMockPlayer.getState().sentence).toBe(0);
    useMockPlayer.getState().seek(10_000);
    expect(useMockPlayer.getState().sentence).toBe(MOCK_SENTENCES.length - 1);
  });

  it('estimates time left from remaining words and rate', () => {
    expect(mockTimeLeft(0, 0, 2)).toBeCloseTo(mockTimeLeft(0, 0, 1) / 2);
    expect(mockTimeLeft(MOCK_SENTENCES.length - 1, 0, 1)).toBeLessThan(mockTimeLeft(0, 0, 1));
  });
});
