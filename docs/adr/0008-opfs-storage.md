# 0008: OPFS throughput, persistence and quota (spike 6)

Status: **works as planned**.

## Measurements (extension page, Apple M3 Max SSD)

| Operation on Kokoro `model.onnx` (325,532,171 bytes)     | Time   | Throughput |
| -------------------------------------------------------- | ------ | ---------- |
| Streamed `fetch` → `createWritable()` (localhost source) | 0.84 s | 387 MB/s   |
| `getFile().arrayBuffer()`                                | 0.13 s | 2.5 GB/s   |
| SHA-256 (`crypto.subtle.digest`)                         | 0.21 s | –          |

The digest matched Hugging Face's LFS oid. `navigator.storage.estimate()` reported a 262 GB quota.
`navigator.storage.persist()` returned **false** in the fresh headless profile.

## Decision

- Store models in OPFS as planned; stream downloads straight into a writable, never into memory.
- Full SHA-256 on install and a cheap size check plus sampled hash on each load (§6.7); a full hash
  costs only ~0.2 s, so "Repair model" can always do a full check.
- Request `persist()` and show its result on the Storage page. With `unlimitedStorage` the extension
  is exempt from quota pressure anyway; record persistence status in diagnostics.
