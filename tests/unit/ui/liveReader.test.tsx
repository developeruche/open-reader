import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore } from 'zustand/vanilla';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderState } from '@/pdf/readerController';

const calls: unknown[][] = [];
const record =
  (name: string) =>
  (...args: unknown[]) => {
    calls.push([name, ...args]);
  };

const BASE: ReaderState = {
  phase: 'empty',
  progress: null,
  title: '',
  fileName: '',
  docId: null,
  page: 1,
  pages: 0,
  scale: 'page-width',
  state: 'idle',
  sentence: 0,
  sentences: 0,
  rate: 1,
  voice: 'af_heart',
  engine: 'kokoro',
  backend: 'wasm',
  follow: true,
  rules: { headersFooters: 'skip', references: 'skip', captions: 'read' } as ReaderState['rules'],
  error: null,
  notice: null,
  firstPageMs: 0,
  layoutMs: 0,
  emptyPages: [],
};

let fake: FakeController;

class FakeController {
  store = createStore<ReaderState>(() => ({ ...BASE }));
  view = {
    outline: vi.fn(async () => [
      { title: 'Introduction', dest: 'intro', items: [{ title: 'Background', dest: 'bg' }] },
    ]),
    find: vi.fn(record('find')),
    goTo: vi.fn(record('goTo')),
    thumbnail: vi.fn(async () => undefined),
    pageDiv: () => {
      const d = document.createElement('div');
      d.getBoundingClientRect = () => new DOMRect(0, 0, 600, 800);
      return d;
    },
  };
  nav = {
    length: 2,
    at: (i: number) => ({ sentence: { start: i * 10, end: i * 10 + 10 } }),
  };
  opened = {
    pages: [{ page: 1, width: 600, height: 800, items: [] }],
    layout: {
      order: [
        { block: 0, page: 1, x: 72, y: 700 },
        { block: 0, page: 1, x: 72, y: 680 },
      ],
    },
  };
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test drives the instance the component creates
    fake = this;
  }
  get state() {
    return this.store.getState();
  }
  attach = record('attach');
  destroy = record('destroy');
  openBytes = vi.fn(async (_b: Uint8Array, name: string) => {
    calls.push(['openBytes', name]);
    this.store.setState({ phase: 'ready', docId: 'd1', pages: 2, sentences: 2, title: name });
  });
  setRules = vi.fn(async (r: unknown) => calls.push(['setRules', r]));
  send = record('send');
  setFollow = record('setFollow');
  goToPage = record('goToPage');
  setScale = record('setScale');
}

vi.mock('@/pdf/readerController', () => ({ ReaderController: FakeController }));
const recent = vi.fn(async () => [
  { docId: 'p1', kind: 'pdf', title: 'Old paper', updatedAt: 0 },
  { docId: 'w1', kind: 'web', title: 'A page', updatedAt: 0 },
]);
vi.mock('@/platform/library', () => ({
  IdbLibrary: class {
    recent = recent;
  },
}));
const loadPdf = vi.fn(async (): Promise<Uint8Array | undefined> => new Uint8Array([1]));
const fileAccessAllowed = vi.fn(async () => false);
vi.mock('@/platform/documents', () => ({
  loadPdf: () => loadPdf(),
  fileAccessAllowed: () => fileAccessAllowed(),
  fetchPdf: vi.fn(async () => new Uint8Array([2])),
}));
const toast = vi.fn();
vi.mock('@/ui/components', async (orig) => ({
  ...(await orig<typeof import('@/ui/components')>()),
  toast: (t: unknown) => toast(t),
}));

const { LiveReader: Reader } = await import('@/ui/shells/LiveReader');
const { TooltipProvider } = await import('@/ui/components');
const LiveReader = () => (
  <TooltipProvider>
    <Reader />
  </TooltipProvider>
);

class IO {
  constructor(private readonly cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  disconnect() {}
}

beforeEach(() => {
  calls.length = 0;
  toast.mockClear();
  vi.stubGlobal('IntersectionObserver', IO);
  history.replaceState(null, '', '/reader.html');
});

describe('LiveReader', () => {
  it('shows the empty state with recent PDFs and opens a chosen file', async () => {
    render(<LiveReader />);
    expect(await screen.findByText('Old paper')).toBeTruthy();
    expect(screen.queryByText('A page')).toBeNull();
    expect(calls[0]?.[0]).toBe('attach');

    const file = new File([new Uint8Array([1, 2])], 'paper.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Choose a PDF'), file);
    expect(calls).toContainEqual(['openBytes', 'paper.pdf']);
    expect(location.search).toBe('?doc=d1&name=paper.pdf');
  });

  it('reopens a stored document and drives navigation, search, rules and transport', async () => {
    history.replaceState(null, '', '/reader.html?doc=abc&name=Stored.pdf');
    render(<LiveReader />);
    expect(await screen.findByRole('button', { name: 'Page 2' })).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Outline' }));
    expect(await screen.findByRole('button', { name: 'Introduction' })).toBeTruthy();
    expect(calls).toContainEqual(['openBytes', 'Stored.pdf']);

    await userEvent.click(screen.getByRole('button', { name: 'Background' }));
    expect(calls).toContainEqual(['goTo', 'bg']);

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(calls).toContainEqual(['goToPage', 2]);

    await userEvent.type(screen.getByLabelText('Search in document'), 'zebra{Enter}');
    expect(calls).toContainEqual(['find', 'zebra', true]);

    await userEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(calls).toContainEqual(['goToPage', 2]);
    expect(fake.view.thumbnail).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Show reading rules' }));
    await userEvent.click(screen.getByRole('switch', { name: /Skip figure captions/ }));
    expect(fake.setRules).toHaveBeenCalledWith(expect.objectContaining({ captions: 'skip' }));
    await userEvent.click(screen.getByRole('switch', { name: /Show reading order/ }));

    await userEvent.click(screen.getByRole('button', { name: /^Play/ }));
    expect(calls).toContainEqual(['send', { type: 'TOGGLE' }]);

    act(() => fake.store.setState({ notice: 'Skipped a table', emptyPages: [2] }));
    expect(toast).toHaveBeenCalledWith({ kind: 'info', title: 'Skipped a table' });
    expect(screen.getByText(/1 page has no text layer/)).toBeTruthy();
  });

  it('reports a document that is no longer stored', async () => {
    loadPdf.mockResolvedValueOnce(undefined);
    history.replaceState(null, '', '/reader.html?doc=gone');
    render(<LiveReader />);
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })),
    );
  });

  it('asks for file access before reading a local PDF', async () => {
    history.replaceState(null, '', '/reader.html?src=file%3A%2F%2F%2Ftmp%2Fa.pdf');
    render(<LiveReader />);
    expect(await screen.findByText('Allow access to local files')).toBeTruthy();
  });

  it('opens a PDF by URL', async () => {
    history.replaceState(
      null,
      '',
      '/reader.html?src=https%3A%2F%2Fx.test%2Fdocs%2FMy%2520Paper.pdf',
    );
    render(<LiveReader />);
    await vi.waitFor(() => expect(calls).toContainEqual(['openBytes', 'My Paper.pdf']));
    act(() => fake.store.setState({ phase: 'loading', progress: { page: 3, total: 10 } }));
    expect(screen.getByText(/Opening/)).toBeTruthy();
  });
});
