// Layout analysis off the main thread (PLAN.md §8.3).
import * as Comlink from 'comlink';
import { analyzeLayout } from './layout';

Comlink.expose({ analyzeLayout });
