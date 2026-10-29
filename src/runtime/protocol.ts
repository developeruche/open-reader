/**
 * Messages between the background, engine hosts (offscreen document, reader page), UI surfaces and
 * content scripts. Long-lived ports carry them; port names are below.
 */
import { z } from 'zod';
import type { ReadingDocument, ReadingPosition } from '@/core/document/model';
import type { Cursor, PlayerEvent, PlayerStateValue } from '@/core/player/machine';
import type { PlayerNotice } from '@/core/player/player';
import type { SyncEvent } from '@/core/player/sync';
import type { PacingPreset } from '@/core/text/pacing';

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
  | { type: 'UNLOAD'; sessionId: string };

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
}

export type HostEvent =
  | { type: 'HELLO'; host: HostKind; status: HostStatus | null }
  | { type: 'STATUS'; status: HostStatus }
  | { type: 'SYNC'; event: SyncEvent }
  | { type: 'POSITION'; position: ReadingPosition }
  | { type: 'NOTICE'; sessionId: string; notice: PlayerNotice };

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

export type UiMessage = { type: 'HELLO'; tabId?: number } | { type: 'COMMAND'; command: UiCommand };

export type UiUpdate =
  | { type: 'SESSION'; session: SessionInfo | null }
  | { type: 'SYNC'; event: SyncEvent }
  | { type: 'NOTICE'; notice: PlayerNotice };

// ── content script ↔ background ────────────────────────────────────────────
export type ContentMessage =
  | { type: 'DOC'; doc: ReadingDocument; url: string; startSentence: number }
  | { type: 'NO_CONTENT'; url: string };

export type ContentUpdate =
  { type: 'SYNC'; event: SyncEvent } | { type: 'EXTRACT'; fromSelection: boolean };
