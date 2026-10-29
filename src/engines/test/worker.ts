// Worker entry for the TestEngine (exercises the same comlink path as real engines).
import type { Endpoint } from 'comlink';
import { exposeEngine } from '../rpc';
import { TestEngine } from './engine';

exposeEngine(new TestEngine(), self as unknown as Endpoint);
