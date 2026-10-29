/** Installs, verifies, repairs and removes models (PLAN.md §6.7). */
import type { KeyValueStore } from '../util/kv';
import type { Backend, ModelManifest } from '../tts/registry';
import { downloadFile, type DownloadOptions, type FileStore, type ModelFile } from './downloader';

export interface InstalledModel {
  modelId: string;
  version: string;
  backend: 'webgpu' | 'wasm' | 'any';
  files: { path: string; bytes: number; sha256: string }[];
  installedAt: number;
}

export type InstalledIndex = Record<string, InstalledModel>;

export const INSTALLED_KEY = 'models.installed';

export interface InstallProgress {
  modelId: string;
  loaded: number;
  total: number;
  file: string;
  phase: 'download' | 'verify' | 'done';
}

export interface ManagerDeps {
  store: FileStore;
  kv: KeyValueStore;
  fetch: DownloadOptions['fetch'];
  hash: DownloadOptions['hash'];
  /** URL of a bundled copy (offline pack), if any. */
  localUrl?(model: ModelManifest, file: ModelFile): string | undefined;
  now?(): number;
}

export const modelDir = (m: Pick<ModelManifest, 'id' | 'version'>) => `models/${m.id}/${m.version}`;
export const filePath = (m: Pick<ModelManifest, 'id' | 'version'>, f: Pick<ModelFile, 'path'>) =>
  `${modelDir(m)}/${f.path}`;

/** Files needed for a backend: shared files plus the backend's own model file. */
export function filesFor(model: ModelManifest, backend: 'webgpu' | 'wasm' | 'any'): ModelFile[] {
  return model.files.filter((f) => !f.backend || backend === 'any' || f.backend === backend);
}

export class ModelManager {
  constructor(private readonly deps: ManagerDeps) {}

  async installed(): Promise<InstalledIndex> {
    return (await this.deps.kv.get<InstalledIndex>(INSTALLED_KEY)) ?? {};
  }

  async isInstalled(model: ModelManifest, backend?: Backend): Promise<boolean> {
    const i = (await this.installed())[model.id];
    if (!i || i.version !== model.version) return false;
    return !backend || backend === 'remote' || i.backend === 'any' || i.backend === backend;
  }

  async install(
    model: ModelManifest,
    backend: 'webgpu' | 'wasm' | 'any',
    o: { signal?: AbortSignal; onProgress?(p: InstallProgress): void } = {},
  ): Promise<InstalledModel> {
    const files = filesFor(model, backend);
    const total = files.reduce((a, f) => a + f.bytes, 0);
    const done = new Map<string, number>();
    const report = (file: string, phase: InstallProgress['phase']) =>
      o.onProgress?.({
        modelId: model.id,
        loaded: [...done.values()].reduce((a, b) => a + b, 0),
        total,
        file,
        phase,
      });
    for (const f of files) {
      const dest = filePath(model, f);
      await downloadFile(f, dest, {
        store: this.deps.store,
        fetch: this.deps.fetch,
        hash: this.deps.hash,
        signal: o.signal,
        localUrl: this.deps.localUrl?.(model, f),
        onProgress: (p) => {
          done.set(f.path, p.loaded);
          report(f.path, p.loaded === p.total ? 'verify' : 'download');
        },
      });
      done.set(f.path, f.bytes);
    }
    const index = await this.installed();
    const prev = index[model.id];
    const merged: InstalledModel = {
      modelId: model.id,
      version: model.version,
      backend: prev && prev.version === model.version && prev.backend !== backend ? 'any' : backend,
      files: model.files
        .filter((f) => prev?.files.some((p) => p.path === f.path) || files.includes(f))
        .map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
      installedAt: (this.deps.now ?? Date.now)(),
    };
    await this.deps.kv.set(INSTALLED_KEY, { ...index, [model.id]: merged });
    report('', 'done');
    return merged;
  }

  /**
   * Integrity check on load (§6.7): sizes always; with `full`, every SHA-256. Returns the paths
   * that failed.
   */
  async verify(model: ModelManifest, full = false): Promise<string[]> {
    const i = (await this.installed())[model.id];
    if (!i) return model.files.map((f) => f.path);
    const bad: string[] = [];
    for (const f of i.files) {
      const dest = filePath(model, f);
      const size = await this.deps.store.size(dest);
      if (size !== f.bytes) {
        bad.push(f.path);
        continue;
      }
      if (full && (await this.deps.hash(await this.deps.store.read(dest))) !== f.sha256)
        bad.push(f.path);
    }
    return bad;
  }

  /** Re-downloads every file that fails a full check. */
  async repair(
    model: ModelManifest,
    o: { signal?: AbortSignal; onProgress?(p: InstallProgress): void } = {},
  ): Promise<string[]> {
    const bad = await this.verify(model, true);
    for (const path of bad) await this.deps.store.remove(filePath(model, { path }));
    const i = (await this.installed())[model.id];
    if (bad.length) await this.install(model, i?.backend ?? 'any', o);
    return bad;
  }

  async remove(model: Pick<ModelManifest, 'id' | 'version'>): Promise<void> {
    await this.deps.store.removeDir(`models/${model.id}`);
    const index = Object.fromEntries(
      Object.entries(await this.installed()).filter(([id]) => id !== model.id),
    );
    await this.deps.kv.set(INSTALLED_KEY, index);
  }
}
