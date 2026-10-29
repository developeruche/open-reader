// Worker entry for Kokoro: model files are read from OPFS (same origin as the extension).
import type { Endpoint } from 'comlink';
import { OpfsStore } from '@/platform/opfs';
import { exposeEngine } from '../rpc';
import { KokoroEngine } from './engine';

// The model directory in OPFS arrives as the worker's name (see engines/factory.ts).
const dir = (self as unknown as { name: string }).name;
const store = new OpfsStore();

exposeEngine(
  new KokoroEngine({
    readFile: (path) => store.read(`${dir}/${path}`),
    dictionaryUrl: new URL('/g2p/en-us.txt', self.location.origin).href,
    ortBase: new URL('/ort/', self.location.origin).href,
  }),
  self as unknown as Endpoint,
);
