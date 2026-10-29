/**
 * Player state machine (PLAN.md §5.5). Side effects are named actions supplied by the Player via
 * `.provide()`, so the machine itself is pure and exhaustively testable.
 */
import { assign, setup } from 'xstate';
import type { PacingPreset } from '../text/pacing';

export interface Cursor {
  /** Index into the navigator's readable sentences. */
  sentence: number;
  /** Part of a split sentence. */
  part: number;
  /** Word to start from (click-to-read); 0 otherwise. */
  word: number;
}

export type NavEvent =
  | { type: 'SEEK'; sentence: number; word?: number }
  | { type: 'NEXT_SENTENCE' }
  | { type: 'PREV_SENTENCE' }
  | { type: 'NEXT_BLOCK' }
  | { type: 'PREV_BLOCK' };

/** Navigation supplied by the Player (knows the document and its segments). */
export interface PlayerNav {
  /** Next segment after the cursor, or undefined at the end. */
  next(c: Cursor): Cursor | undefined;
  /** Target of a navigation event, or undefined if it goes nowhere. */
  resolve(e: NavEvent, c: Cursor): Cursor | undefined;
}

export interface PlayerError {
  message: string;
  /** Every error offers a way out (§5.5 invariant). */
  action: 'retry';
}

export interface PlayerContext {
  cursor: Cursor;
  rate: number;
  voice: string;
  pacing: PacingPreset;
  retries: number;
  error: PlayerError | null;
  /** True when the audio element holds the current segment paused (resume instead of restart). */
  loaded: boolean;
  /** Play as soon as the pending segment is ready (false when seeking while paused). */
  autoplay: boolean;
  hostLost: boolean;
  nav: PlayerNav;
}

export type PlayerEvent =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'TOGGLE' }
  | { type: 'STOP' }
  | NavEvent
  | { type: 'SET_SPEED'; rate: number }
  | { type: 'SET_VOICE'; voice: string }
  | { type: 'SET_PACING'; pacing: PacingPreset }
  | { type: 'SEGMENT_READY' }
  | { type: 'SEGMENT_FAILED'; message: string }
  | { type: 'AUDIO_ENDED' }
  | { type: 'AUDIO_STALLED' }
  | { type: 'HOST_LOST' }
  | { type: 'HOST_RESTORED' }
  | { type: 'DOC_CHANGED' }
  | { type: 'SLEEP_TIMER_FIRED' }
  | { type: 'RETRY' };

export interface PlayerInput {
  nav: PlayerNav;
  start?: Cursor;
  rate?: number;
  voice?: string;
  pacing?: PacingPreset;
}

export const MAX_RETRIES = 2;
const START: Cursor = { sentence: 0, part: 0, word: 0 };

const NAV_TYPES = ['SEEK', 'NEXT_SENTENCE', 'PREV_SENTENCE', 'NEXT_BLOCK', 'PREV_BLOCK'] as const;

export const playerMachine = setup({
  types: {
    context: {} as PlayerContext,
    events: {} as PlayerEvent,
    input: {} as PlayerInput,
  },
  actions: {
    /** Ask the scheduler for the segment at the cursor; it answers SEGMENT_READY/FAILED. */
    requestSegment: () => undefined,
    /** Start (or resume, if loaded) the cursor's segment. */
    startAudio: () => undefined,
    pauseAudio: () => undefined,
    stopAudio: () => undefined,
    applyRate: () => undefined,
    /** Persist the position (every sentence boundary). */
    persist: () => undefined,
    /** Re-plan prefetch from the cursor (voice/pacing/doc change). */
    replan: () => undefined,
    announceError: () => undefined,
    markLoaded: assign({ loaded: true }),
    markUnloaded: assign({ loaded: false }),
    clearError: assign({ error: null, retries: 0 }),
    countRetry: assign({ retries: ({ context }) => context.retries + 1 }),
    setError: assign({
      error: ({ event }) => ({
        message: event.type === 'SEGMENT_FAILED' ? event.message : 'Playback failed',
        action: 'retry' as const,
      }),
    }),
    advance: assign({
      cursor: ({ context }) => context.nav.next(context.cursor) ?? context.cursor,
    }),
    navigate: assign({
      cursor: ({ context, event }) => {
        if (!(NAV_TYPES as readonly string[]).includes(event.type)) return context.cursor;
        return context.nav.resolve(event as NavEvent, context.cursor) ?? context.cursor;
      },
    }),
    rewind: assign({ cursor: () => START }),
    setRate: assign({
      rate: ({ context, event }) =>
        event.type === 'SET_SPEED' ? Math.max(0.5, Math.min(4, event.rate)) : context.rate,
    }),
    setVoice: assign({
      voice: ({ context, event }) => (event.type === 'SET_VOICE' ? event.voice : context.voice),
    }),
    setPacing: assign({
      pacing: ({ context, event }) => (event.type === 'SET_PACING' ? event.pacing : context.pacing),
    }),
    autoplayOn: assign({ autoplay: true }),
    autoplayOff: assign({ autoplay: false }),
    hostLost: assign({ hostLost: true, loaded: false }),
    hostRestored: assign({ hostLost: false }),
  },
  guards: {
    hasNext: ({ context }) => context.nav.next(context.cursor) !== undefined,
    navGoesSomewhere: ({ context, event }) =>
      (NAV_TYPES as readonly string[]).includes(event.type) &&
      context.nav.resolve(event as NavEvent, context.cursor) !== undefined,
    canRetry: ({ context }) => context.retries < MAX_RETRIES,
    autoplay: ({ context }) => context.autoplay,
  },
  delays: {
    backoff: ({ context }) => 250 * 2 ** context.retries,
  },
}).createMachine({
  id: 'player',
  context: ({ input }) => ({
    cursor: input.start ?? START,
    rate: input.rate ?? 1,
    voice: input.voice ?? 'default',
    pacing: input.pacing ?? 'natural',
    retries: 0,
    error: null,
    loaded: false,
    autoplay: true,
    hostLost: false,
    nav: input.nav,
  }),
  initial: 'idle',
  on: {
    SET_SPEED: { actions: ['setRate', 'applyRate'] },
    SET_PACING: { actions: ['setPacing', 'replan'] },
    DOC_CHANGED: { target: '.idle', actions: ['stopAudio', 'markUnloaded', 'rewind', 'replan'] },
    STOP: { target: '.idle', actions: ['stopAudio', 'markUnloaded', 'persist'] },
    HOST_LOST: { target: '.paused', actions: ['stopAudio', 'hostLost'] },
  },
  states: {
    idle: {
      on: {
        PLAY: { target: 'preparing', actions: 'autoplayOn' },
        TOGGLE: { target: 'preparing', actions: 'autoplayOn' },
        SEEK: { actions: 'navigate' },
        NEXT_SENTENCE: { actions: 'navigate' },
        PREV_SENTENCE: { actions: 'navigate' },
        NEXT_BLOCK: { actions: 'navigate' },
        PREV_BLOCK: { actions: 'navigate' },
        SET_VOICE: { actions: ['setVoice', 'replan'] },
      },
    },
    preparing: {
      entry: 'requestSegment',
      on: {
        SEGMENT_READY: [{ guard: 'autoplay', target: 'playing' }, { target: 'paused' }],
        SEGMENT_FAILED: [
          { guard: 'canRetry', target: 'retrying', actions: 'countRetry' },
          { target: 'error', actions: 'setError' },
        ],
        PAUSE: { target: 'paused' },
        TOGGLE: { target: 'paused' },
        SEEK: { target: 'seeking', reenter: true, actions: 'navigate' },
        NEXT_SENTENCE: { target: 'seeking', actions: 'navigate' },
        PREV_SENTENCE: { target: 'seeking', actions: 'navigate' },
        NEXT_BLOCK: { target: 'seeking', actions: 'navigate' },
        PREV_BLOCK: { target: 'seeking', actions: 'navigate' },
        SET_VOICE: { target: 'seeking', actions: ['setVoice', 'replan'] },
      },
    },
    buffering: {
      entry: 'requestSegment',
      on: {
        SEGMENT_READY: { target: 'playing' },
        SEGMENT_FAILED: [
          { guard: 'canRetry', target: 'retrying', actions: 'countRetry' },
          { target: 'error', actions: 'setError' },
        ],
        PAUSE: { target: 'paused' },
        TOGGLE: { target: 'paused' },
        SEEK: { target: 'seeking', actions: 'navigate' },
        NEXT_SENTENCE: { target: 'seeking', actions: 'navigate' },
        PREV_SENTENCE: { target: 'seeking', actions: 'navigate' },
        NEXT_BLOCK: { target: 'seeking', actions: 'navigate' },
        PREV_BLOCK: { target: 'seeking', actions: 'navigate' },
        SET_VOICE: { target: 'seeking', actions: ['setVoice', 'replan'] },
      },
    },
    playing: {
      entry: ['startAudio', 'markLoaded', 'clearError', 'persist'],
      on: {
        PAUSE: { target: 'paused', actions: 'pauseAudio' },
        TOGGLE: { target: 'paused', actions: 'pauseAudio' },
        SLEEP_TIMER_FIRED: { target: 'paused', actions: 'pauseAudio' },
        AUDIO_ENDED: [
          {
            guard: 'hasNext',
            target: 'buffering',
            actions: ['markUnloaded', 'advance', 'persist'],
          },
          { target: 'ended', actions: ['markUnloaded', 'persist'] },
        ],
        AUDIO_STALLED: { target: 'buffering', actions: ['stopAudio', 'markUnloaded'] },
        SEEK: {
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOn'],
        },
        NEXT_SENTENCE: {
          guard: 'navGoesSomewhere',
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOn'],
        },
        PREV_SENTENCE: {
          guard: 'navGoesSomewhere',
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOn'],
        },
        NEXT_BLOCK: {
          guard: 'navGoesSomewhere',
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOn'],
        },
        PREV_BLOCK: {
          guard: 'navGoesSomewhere',
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOn'],
        },
        SET_VOICE: {
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'setVoice', 'replan', 'autoplayOn'],
        },
      },
    },
    paused: {
      entry: 'persist',
      on: {
        PLAY: [
          {
            guard: ({ context }) => context.hostLost,
            target: 'preparing',
            actions: ['hostRestored', 'autoplayOn'],
          },
          { target: 'resuming' },
        ],
        TOGGLE: [
          {
            guard: ({ context }) => context.hostLost,
            target: 'preparing',
            actions: ['hostRestored', 'autoplayOn'],
          },
          { target: 'resuming' },
        ],
        HOST_RESTORED: { actions: 'hostRestored' },
        SEEK: {
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOff'],
        },
        NEXT_SENTENCE: {
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOff'],
        },
        PREV_SENTENCE: {
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOff'],
        },
        NEXT_BLOCK: {
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOff'],
        },
        PREV_BLOCK: {
          target: 'seeking',
          actions: ['stopAudio', 'markUnloaded', 'navigate', 'autoplayOff'],
        },
        SET_VOICE: { actions: ['stopAudio', 'markUnloaded', 'setVoice', 'replan'] },
      },
    },
    /** Resume a loaded segment, or load it first. */
    resuming: {
      always: [
        { guard: ({ context }) => context.loaded, target: 'playing' },
        { target: 'preparing', actions: 'autoplayOn' },
      ],
    },
    seeking: {
      entry: ['requestSegment', 'persist'],
      on: {
        SEGMENT_READY: [{ guard: 'autoplay', target: 'playing' }, { target: 'paused' }],
        SEGMENT_FAILED: [
          { guard: 'canRetry', target: 'retrying', actions: 'countRetry' },
          { target: 'error', actions: 'setError' },
        ],
        SEEK: { target: 'seeking', reenter: true, actions: 'navigate' },
        NEXT_SENTENCE: { target: 'seeking', reenter: true, actions: 'navigate' },
        PREV_SENTENCE: { target: 'seeking', reenter: true, actions: 'navigate' },
        NEXT_BLOCK: { target: 'seeking', reenter: true, actions: 'navigate' },
        PREV_BLOCK: { target: 'seeking', reenter: true, actions: 'navigate' },
        PAUSE: { actions: 'autoplayOff' },
        TOGGLE: [{ guard: 'autoplay', actions: 'autoplayOff' }, { actions: 'autoplayOn' }],
        PLAY: { actions: 'autoplayOn' },
        SET_VOICE: { target: 'seeking', reenter: true, actions: ['setVoice', 'replan'] },
      },
    },
    retrying: {
      after: { backoff: { target: 'seeking', reenter: true } },
      on: {
        PAUSE: { target: 'paused', actions: 'autoplayOff' },
        SEEK: { target: 'seeking', actions: 'navigate' },
      },
    },
    error: {
      entry: 'announceError',
      on: {
        RETRY: { target: 'seeking', actions: ['clearError', 'autoplayOn'] },
        PLAY: { target: 'seeking', actions: ['clearError', 'autoplayOn'] },
        TOGGLE: { target: 'seeking', actions: ['clearError', 'autoplayOn'] },
        SEEK: { target: 'seeking', actions: ['clearError', 'navigate', 'autoplayOn'] },
        NEXT_SENTENCE: { target: 'seeking', actions: ['clearError', 'navigate', 'autoplayOn'] },
        SET_VOICE: {
          target: 'seeking',
          actions: ['clearError', 'setVoice', 'replan', 'autoplayOn'],
        },
      },
    },
    ended: {
      on: {
        PLAY: { target: 'preparing', actions: ['rewind', 'autoplayOn'] },
        TOGGLE: { target: 'preparing', actions: ['rewind', 'autoplayOn'] },
        SEEK: { target: 'seeking', actions: ['navigate', 'autoplayOn'] },
        PREV_SENTENCE: { target: 'seeking', actions: ['navigate', 'autoplayOn'] },
        PREV_BLOCK: { target: 'seeking', actions: ['navigate', 'autoplayOn'] },
      },
    },
  },
});

export type PlayerStateValue =
  | 'idle'
  | 'preparing'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'resuming'
  | 'seeking'
  | 'retrying'
  | 'error'
  | 'ended';
