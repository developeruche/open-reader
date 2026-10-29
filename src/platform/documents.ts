/** PDFs stored in OPFS by SHA-256 (`documents/<sha256>.pdf`) so the library reopens them offline. */
import { browser } from 'wxt/browser';
import { OpfsStore, sha256Subtle } from './opfs';

const store = new OpfsStore();
const path = (id: string) => `documents/${id}.pdf`;

export async function savePdf(bytes: Uint8Array): Promise<string> {
  const id = await sha256Subtle(bytes.slice().buffer);
  if ((await store.size(path(id))) === bytes.byteLength) return id;
  const w = await store.appender(path(id));
  await w.write(bytes);
  await w.close();
  await store.commit(path(id));
  return id;
}

export async function loadPdf(id: string): Promise<Uint8Array | undefined> {
  if (!/^[0-9a-f]{64}$/.test(id)) return undefined;
  try {
    return new Uint8Array(await store.read(path(id)));
  } catch {
    return undefined;
  }
}

/** file:// PDFs need "Allow access to file URLs" (§8.1). */
export async function fileAccessAllowed(): Promise<boolean> {
  return browser.extension.isAllowedFileSchemeAccess();
}

export async function fetchPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Could not download the PDF (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}
