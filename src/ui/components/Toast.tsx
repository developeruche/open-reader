import { Toast as T } from 'radix-ui';
import { create } from 'zustand';
import { AlertCircle, CheckCircle, Info, X } from '../icons';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  action?: { label: string; onClick(): void };
}

interface ToastState {
  toasts: ToastMessage[];
  push(t: Omit<ToastMessage, 'id'>): void;
  dismiss(id: number): void;
}

let nextId = 1;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: nextId++ }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (t: Omit<ToastMessage, 'id'>) => useToasts.getState().push(t);

const ICONS = { info: Info, success: CheckCircle, error: AlertCircle } as const;
const LABELS = { info: 'Note', success: 'Done', error: 'Error' } as const;

/** Renders queued toasts. Errors use ink, a bold label and an icon (no colour). */
export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <T.Provider swipeDirection="right" duration={6000}>
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <T.Root
            key={t.id}
            type={t.kind === 'error' ? 'foreground' : 'background'}
            duration={t.kind === 'error' ? 12000 : 6000}
            onOpenChange={(open) => !open && dismiss(t.id)}
            className="flex w-full items-start gap-3 rounded-card border border-line bg-paper p-3 shadow-float"
          >
            <Icon size={18} aria-hidden className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <T.Title className="text-sm text-ink">
                <span className="font-semibold">{LABELS[t.kind]}:</span> {t.title}
              </T.Title>
              {t.description ? (
                <T.Description className="mt-0.5 text-[13px] text-ink-2">
                  {t.description}
                </T.Description>
              ) : null}
              {t.action ? (
                <T.Action altText={t.action.label} asChild>
                  <button
                    type="button"
                    onClick={t.action.onClick}
                    className="mt-2 text-[13px] font-medium text-ink underline underline-offset-2"
                  >
                    {t.action.label}
                  </button>
                </T.Action>
              ) : null}
            </div>
            <T.Close
              aria-label="Dismiss"
              className="rounded-control p-1 text-muted hover:bg-hover hover:text-ink"
            >
              <X size={14} aria-hidden />
            </T.Close>
          </T.Root>
        );
      })}
      <T.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2 outline-none" />
    </T.Provider>
  );
}
