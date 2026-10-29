/**
 * Messages between the background, engine hosts (offscreen document, reader page), UI surfaces and
 * content scripts. Long-lived ports carry them; port names are below.
 */
import { z } from 'zod';
import type { ReadingDocument, ReadingPosition } from '@/core/document/model';
import type { Cursor, PlayerEvent, PlayerStateValue } from '@/core/player/machine';
import type { PlayerNotice, PlayerStats } from '@/core/player/player';
import type { SyncEvent } from '@/core/player/sync';
import type { PacingPreset } from '@/core/text/pacing';
import type { SkipRules } from '@/core/text/skip';
import type { EngineChoice } from '@/core/tts/fallback';
import type { DiagnosticsReport } from './orchestrator';
import type { TtsEvent, TtsSpeakOptions } from '@/engines/system/tts';

export const PORT = {
  engineHost: 'engine-host',
  inpageHost: 'inpage-host',
  ui: 'ui',
  content: 'content',
} as const;

export type HostKind = 'offscreen' | 'inpage';

export interface SessionSettings {
  rate: number;
  voice: string;
  pacing: PacingPreset;
  engineId: string;
  /** Installed model for render engines (from the registry). */
  modelId?: string;
  backend?: 'webgpu' | 'wasm';
  skipRules?: SkipRules;
  /** Audio cache cap from settings. */
  cacheCapBytes?: number;
  /** Engines to try, in order, when this one fails (§9.2). */
  fallbacks?: EngineChoice[];
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  rate: 1,
  voice: 'test',
  pacing: 'natural',
  engineId: 'test',
};

/** Live session state, mirrored in chrome.storage.session so restarts can resume. */
export interface SessionInfo {
  sessionId: string;
  docId: string;
  title: string;
  host: HostKind;
  /** Tab whose page is being read (web mode). */
  tabId?: number;
  url?: string;
  state: PlayerStateValue;
  cursor: Cursor;
  settings: SessionSettings;
  sentenceCount: number;
  hostLost: boolean;
  error: string | null;
  updatedAt: number;
  engine?: string;
  backend?: string;
}

/** Diagnostics numbers a host reports every second while a session is loaded (§9.2). */
export interface HostStats extends PlayerStats {
  sessionId: string;
  host: HostKind;
  engine: string;
  backend: string;
  state: PlayerStateValue;
  /** Engine switches down the fallback ladder in this session. */
  fallbacks: number;
  engineRestarts: number;
  at: number;
}

// ── background → engine host ───────────────────────────────────────────────
export type HostCommand =
  | {
      type: 'LOAD';
      sessionId: string;
      doc: ReadingDocument;
      start: { sentence: number; word: number };
      settings: SessionSettings;
      autoplay: boolean;
    }
  | { type: 'PLAYER'; sessionId: string; event: PlayerEvent }
  | { type: 'UNLOAD'; sessionId: string }
  /** chrome.tts events relayed to the offscreen host (it has no chrome.tts). */
  | { type: 'TTS_EVENT'; id: number; event: TtsEvent };

// ── engine host → background ───────────────────────────────────────────────
export interface HostStatus {
  sessionId: string;
  state: PlayerStateValue;
  cursor: Cursor;
  rate: number;
  voice: string;
  sentenceCount: number;
  error: string | null;
  /** Segments audible in this host right now (diagnostics; must never exceed 1). */
  audible: number;
  /** Engine and backend actually running, for the status line ("Kokoro · WebGPU"). */
  engine?: string;
  backend?: string;
}

export type HostEvent =
  | { type: 'HELLO'; host: HostKind; status: HostStatus | null }
  | { type: 'STATUS'; status: HostStatus }
  | { type: 'SYNC'; event: SyncEvent }
  | { type: 'POSITION'; position: ReadingPosition }
  | { type: 'NOTICE'; sessionId: string; notice: PlayerNotice }
  | { type: 'STATS'; stats: HostStats }
  /** The offscreen host asks the background to drive chrome.tts. */
  | { type: 'TTS'; op: 'speak'; id: number; text: string; options: TtsSpeakOptions }
  | { type: 'TTS'; op: 'pause' | 'resume' | 'stop' };

// ── UI ↔ background ─────────────────────────────────────────────────────────
const playerCommands = [
  'PLAY',
  'PAUSE',
  'TOGGLE',
  'STOP',
  'NEXT_SENTENCE',
  'PREV_SENTENCE',
  'NEXT_BLOCK',
  'PREV_BLOCK',
  'RETRY',
  'SLEEP_TIMER_FIRED',
] as const;

export const UiCommandSchema = z.union([
  z.object({ type: z.enum(playerCommands) }),
  z.object({
    type: z.literal('SEEK'),
    sentence: z.number().int().nonnegative(),
    word: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('SET_SPEED'), rate: z.number().min(0.5).max(4) }),
  z.object({ type: z.literal('SET_VOICE'), voice: z.string().min(1) }),
  z.object({ type: z.literal('SET_PACING'), pacing: z.enum(['brisk', 'natural', 'relaxed']) }),
  /** Read the page in a tab (web mode). */
  z.object({
    type: z.literal('READ_TAB'),
    tabId: z.number().int(),
    fromSelection: z.boolean().optional(),
  }),
]);

export type UiCommand =
  | { type: (typeof playerCommands)[number] }
  | { type: 'SEEK'; sentence: number; word?: number }
  | { type: 'SET_SPEED'; rate: number }
  | { type: 'SET_VOICE'; voice: string }
  | { type: 'SET_PACING'; pacing: PacingPreset }
  | { type: 'READ_TAB'; tabId: number; fromSelection?: boolean };

export function parseUiCommand(raw: unknown): UiCommand | undefined {
  const r = UiCommandSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

export type UiMessage =
  | { type: 'HELLO'; tabId?: number }
  | { type: 'COMMAND'; command: UiCommand }
  /** Diagnostics page: asks for a DIAGNOSTICS update. */
  | { type: 'DIAGNOSTICS' };

export type UiUpdate =
  | { type: 'SESSION'; session: SessionInfo | null }
  /** The document being read (reader view and outline). */
  | { type: 'DOC'; doc: ReadingDocument }
  | { type: 'SYNC'; event: SyncEvent }
  | { type: 'NOTICE'; notice: PlayerNotice }
  | { type: 'DIAGNOSTICS'; report: DiagnosticsReport };

// ── content script ↔ background ────────────────────────────────────────────
export type ContentMessage =
  /** Without `startAt`, resume where the reader left off. */
  | { type: 'DOC'; doc: ReadingDocument; url: string; startAt?: TextPoint }
  | { type: 'NO_CONTENT'; url: string }
  /** Keyboard shortcuts and the mini player on the page. */
  | { type: 'COMMAND'; command: UiCommand }
  /** Click-to-read inside the document being read. */
  | { type: 'SEEK'; docId: string; at: TextPoint }
  /** The page changed under us and highlights moved to the side panel only. */
  | { type: 'NOTE'; message: string };

/** A position in a block's display text (sentence numbers depend on reading rules, so the
 *  background resolves them). */
export interface TextPoint {
  blockId: string;
  offset: number;
}

export interface ContentSession {
  /** True when this tab's page is the one being read. */
  active: boolean;
  docId: string | null;
  state: PlayerStateValue | null;
  rate: number;
}

export type ContentUpdate =
  | { type: 'SYNC'; event: SyncEvent }
  | { type: 'EXTRACT'; fromSelection: boolean; fromHere?: boolean }
  | { type: 'SESSION'; session: ContentSession };
