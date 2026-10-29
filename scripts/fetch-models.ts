/**
 * Downloads model files from the registry into models/cache/<engine>/<path> (gitignored),
 * verifying SHA-256. Used by `pnpm build:offline` and the model tests.
 *   pnpm models:fetch                 # the default model (Kokoro, both backends)
 *   pnpm models:fetch all             # every registry model
 *   pnpm models:fetch <model-id> ...  # specific models
 */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RegistrySchema } from '../src/core/tts/registry';
import registryJson from '../models/registry.json';

const registry = RegistrySchema.parse(registryJson);
const args = process.argv.slice(2);
const wanted = args.includes('all')
  ? registry.models
  : args.length
    ? registry.models.filter((m) => args.includes(m.id))
    : registry.models.filter((m) => m.engine === 'kokoro');

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

for (const model of wanted) {
  for (const f of model.files) {
    const dest = path.join('models/cache', model.engine, f.path);
    if (existsSync(dest) && statSync(dest).size === f.bytes && (await sha256(dest)) === f.sha256) {
      console.log(`ok       ${model.id}/${f.path}`);
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    process.stdout.write(`download ${model.id}/${f.path} (${Math.round(f.bytes / 1e6)} MB)… `);
    const res = await fetch(f.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${f.url}`);
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      createWriteStream(tmp),
    );
    const actual = await sha256(tmp);
    if (actual !== f.sha256) throw new Error(`checksum mismatch for ${f.path}: ${actual}`);
    renameSync(tmp, dest);
    console.log('verified');
  }
}
