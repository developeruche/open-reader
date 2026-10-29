/** Device and build facts for Diagnostics (no identifiers beyond the user agent). */
import { browser } from 'wxt/browser';

export interface EnvironmentInfo {
  version: string;
  userAgent: string;
  cores: number;
  memoryGB: number | null;
  webgpu: { vendor: string; architecture: string } | null;
  crossOriginIsolated: boolean;
}

interface GpuLike {
  requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null>;
}

export async function environmentInfo(): Promise<EnvironmentInfo> {
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  return {
    version: browser.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    memoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    webgpu: adapter
      ? { vendor: adapter.info?.vendor ?? '', architecture: adapter.info?.architecture ?? '' }
      : null,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  };
}
