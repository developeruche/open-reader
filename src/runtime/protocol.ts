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
import type { LexiconConfig } from '@/core/text/lexicon';
import { SkipRulesSchema, type SkipRules } from '@/core/text/skip';
import type { SleepChoice, SleepTimer } from '@/core/player/sleep';
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
  /** User pronunciations and enabled domain packs (§5.2.4). */
  lexicon?: LexiconConfig;
}

export type ExportFormat = 'mp3' | 'wav';

/** An audiobook export, as the UI shows it. */
export interface ExportStatus {
  jobId: string;
  format: ExportFormat;
  state: 'running' | 'done' | 'error' | 'cancelled';
  phase: 'render' | 'encode';
  /** 0–1 over both passes. */
  fraction: number;
  filename?: string;
  message?: string;
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
  /** Running sleep timer, if any. */
  sleep?: SleepTimer | null;
  /** Rules chosen for this document, when they differ from the defaults. */
  docRules?: SkipRules | null;
  exportJob?: ExportStatus | null;
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
  /** Pronunciations changed: re-plan upcoming segments with the new lexicon. */
  | { type: 'SET_LEXICON'; sessionId: string; lexicon: LexiconConfig }
  | { type: 'EXPORT'; sessionId: string; jobId: string; format: ExportFormat; artist?: string }
  | { type: 'EXPORT_CANCEL'; jobId: string }
  /** The download finished: drop the output file and its URL. */
  | { type: 'EXPORT_RELEASE'; jobId: string }
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
  /** Export progress; `url` (a blob: URL of the finished file) comes with state `done`. */
  | { type: 'EXPORT'; status: ExportStatus; url?: string }
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
  z.object({
    type: z.literal('SET_SLEEP'),
    sleep: z
      .union([
        z.object({
          kind: z.literal('minutes'),
          minutes: z
            .number()
            .positive()
            .max(24 * 60),
        }),
        z.object({ kind: z.literal('section') }),
      ])
      .nullable(),
  }),
  /** Reading rules for the current document only; null returns to the defaults. */
  z.object({ type: z.literal('SET_DOC_RULES'), rules: SkipRulesSchema.nullable() }),
  z.object({ type: z.literal('EXPORT'), format: z.enum(['mp3', 'wav']) }),
  z.object({ type: z.literal('EXPORT_CANCEL') }),
  /** Settings changed elsewhere (pronunciations, packs): apply them to the current session. */
  z.object({ type: z.literal('SETTINGS_CHANGED') }),
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
  | { type: 'SET_SLEEP'; sleep: SleepChoice | null }
  | { type: 'SET_DOC_RULES'; rules: SkipRules | null }
  | { type: 'EXPORT'; format: ExportFormat }
  | { type: 'EXPORT_CANCEL' }
  | { type: 'SETTINGS_CHANGED' }
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
