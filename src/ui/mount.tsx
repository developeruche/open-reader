import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { localStore } from '@/platform/kv';
import { Toaster, TooltipProvider } from './components';
import { createAppearanceStore } from './theme';
import type { useAppearanceHook } from './shells/types';
import './styles.css';

/** Mounts an extension page with the shared providers and the persisted appearance. */
export function mount(render: (useAppearance: useAppearanceHook) => ReactNode): void {
  const useAppearance = createAppearanceStore(localStore());
  const root = document.getElementById('root');
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider delayDuration={400}>
        {render(useAppearance)}
        <Toaster />
      </TooltipProvider>
    </StrictMode>,
  );
}
