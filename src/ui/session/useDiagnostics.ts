/** Polls the background for the diagnostics report while the Diagnostics page is open. */
import { useEffect, useState } from 'react';
import type { DiagnosticsReport } from '@/runtime/orchestrator';
import { connectWithRetry } from '@/platform/ports';
import { PORT, type UiMessage, type UiUpdate } from '@/runtime/protocol';

export const DIAGNOSTICS_POLL_MS = 1000;

export function useDiagnostics(): DiagnosticsReport | null {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  useEffect(() => {
    const port = connectWithRetry<UiUpdate, UiMessage>({
      name: PORT.ui,
      onConnect: () => port.post({ type: 'DIAGNOSTICS' }),
      onMessage(m) {
        if (m.type === 'DIAGNOSTICS') setReport(m.report);
      },
    });
    const t = setInterval(() => port.post({ type: 'DIAGNOSTICS' }), DIAGNOSTICS_POLL_MS);
    return () => {
      clearInterval(t);
      port.close();
    };
  }, []);
  return report;
}
