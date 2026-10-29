import { useCallback, useEffect, useRef, useState } from 'react';
import { describeResult, type BenchmarkReport } from '@/core/models/benchmark';
import type { InstalledIndex } from '@/core/models/manager';
import type { VoiceChoice } from '@/core/settings';
import type { ModelManifest } from '@/core/tts/registry';
import { REGISTRY } from '@/engines/factory';
import { localStore } from '@/platform/kv';
import { loadSettings, saveSettings } from '@/platform/settings';
import {
  BENCHMARK_KEY,
  createModelManager,
  defaultBackendFor,
  gpuInfo,
  runBenchmark,
} from '@/runtime/models';

export type JobState = {
  state: 'downloading' | 'paused' | 'error' | 'repairing';
  loaded: number;
  total: number;
  error?: string;
};

export function useModels() {
  const manager = useRef(createModelManager()).current;
  const controllers = useRef(new Map<string, AbortController>());
  const [installed, setInstalled] = useState<InstalledIndex>({});
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [voice, setVoice] = useState<VoiceChoice | null>(null);
  const [gpu, setGpu] = useState(false);

  const refresh = useCallback(async () => {
    setInstalled(await manager.installed());
    setReport((await localStore().get<BenchmarkReport>(BENCHMARK_KEY)) ?? null);
    setVoice((await loadSettings()).voice);
  }, [manager]);

  useEffect(() => {
    void refresh();
    void gpuInfo().then((g) => setGpu(g.available));
  }, [refresh]);

  const setJob = (id: string, j: JobState | null) =>
    setJobs((all) =>
      j ? { ...all, [id]: j } : Object.fromEntries(Object.entries(all).filter(([k]) => k !== id)),
    );

  const install = useCallback(
    async (m: ModelManifest) => {
      const ac = new AbortController();
      controllers.current.set(m.id, ac);
      setJob(m.id, { state: 'downloading', loaded: 0, total: m.sizeBytes });
      try {
        await manager.install(m, defaultBackendFor(m, gpu), {
          signal: ac.signal,
          onProgress: (p) =>
            setJob(m.id, { state: 'downloading', loaded: p.loaded, total: p.total }),
        });
        setJob(m.id, null);
        // The first installed voice becomes the default.
        if (!(await loadSettings()).voice) await setDefault(m, m.defaultVoice);
      } catch (e) {
        if (ac.signal.aborted) setJob(m.id, { state: 'paused', loaded: 0, total: m.sizeBytes });
        else
          setJob(m.id, {
            state: 'error',
            loaded: 0,
            total: m.sizeBytes,
            error: e instanceof Error ? e.message : String(e),
          });
      } finally {
        controllers.current.delete(m.id);
        await refresh();
      }
    },
    [manager, gpu, refresh],
  );

  const pause = useCallback((id: string) => controllers.current.get(id)?.abort(), []);

  const cancel = useCallback(
    async (m: ModelManifest) => {
      controllers.current.get(m.id)?.abort();
      await manager.remove(m);
      setJob(m.id, null);
      await refresh();
    },
    [manager, refresh],
  );

  const remove = useCallback(
    async (m: ModelManifest) => {
      await manager.remove(m);
      const s = await loadSettings();
      if (s.voice?.modelId === m.id) await saveSettings({ voice: null });
      await refresh();
    },
    [manager, refresh],
  );

  const repair = useCallback(
    async (m: ModelManifest) => {
      setJob(m.id, { state: 'repairing', loaded: 0, total: m.sizeBytes });
      try {
        await manager.repair(m, {
          onProgress: (p) => setJob(m.id, { state: 'repairing', loaded: p.loaded, total: p.total }),
        });
        setJob(m.id, null);
      } catch (e) {
        setJob(m.id, {
          state: 'error',
          loaded: 0,
          total: m.sizeBytes,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await refresh();
    },
    [manager, refresh],
  );

  const setDefault = useCallback(
    async (m: ModelManifest, voiceId: string) => {
      const backend =
        report?.results.find((r) => r.modelId === m.id && !r.error && r.audible)?.backend ??
        defaultBackendFor(m, gpu);
      await saveSettings({ voice: { engineId: m.engine, modelId: m.id, backend, voice: voiceId } });
      await refresh();
    },
    [gpu, report, refresh],
  );

  const benchmark = useCallback(async () => {
    setBenchmarking(true);
    try {
      const r = await runBenchmark(manager);
      setReport(r);
      const choice = r.choice;
      const m = choice && REGISTRY.models.find((x) => x.id === choice.modelId);
      if (choice && m)
        await saveSettings({
          voice: {
            engineId: choice.engineId,
            modelId: choice.modelId,
            backend: choice.backend,
            voice: m.defaultVoice,
          },
        });
      return r;
    } finally {
      setBenchmarking(false);
      await refresh();
    }
  }, [manager, refresh]);

  const benchmarkText = report?.choice
    ? (() => {
        const r = report.results.find(
          (x) => x.modelId === report.choice?.modelId && x.backend === report.choice?.backend,
        );
        return r ? describeResult(r) : null;
      })()
    : null;

  return {
    models: REGISTRY.models.filter((m) => m.engine !== 'test'),
    installed,
    jobs,
    report,
    benchmarkText,
    benchmarking,
    voice,
    gpu,
    install,
    pause,
    cancel,
    remove,
    repair,
    setDefault,
    benchmark,
    manager,
  };
}
