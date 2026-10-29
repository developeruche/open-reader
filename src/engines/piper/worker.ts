// Worker entry for Piper: model files from OPFS; phonemizer and ORT from the extension bundle.
import type { Endpoint } from 'comlink';
import { OpfsStore } from '@/platform/opfs';
import { exposeEngine } from '../rpc';
import { PiperEngine } from './engine';
import { createPhonemizer } from './phonemize';

const dir = (self as unknown as { name: string }).name;
const store = new OpfsStore();

exposeEngine(
  new PiperEngine({
    readFile: (path) => store.read(`${dir}/${path}`),
    phonemize: createPhonemizer(new URL('/piper/', self.location.origin).href),
    ortBase: new URL('/ort/', self.location.origin).href,
  }),
  self as unknown as Endpoint,
);
