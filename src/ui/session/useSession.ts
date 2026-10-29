/** Connects a UI surface to the background session: state, document, sync clock and commands. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReadingDocument } from '@/core/document/model';
import { ClockFollower } from '@/core/player/sync';
import { connectWithRetry, type ReconnectingPort } from '@/platform/ports';
import { targetTabId } from '@/platform/tabs';
import {
  PORT,
  type SessionInfo,
  type UiCommand,
  type UiMessage,
  type UiUpdate,
} from '@/runtime/protocol';
import { toast } from '../components';
import { docView } from './docView';

export interface LiveWord {
  sentenceId: string | null;
  /** Index into the sentence's words, or -1. */
  word: number;
}

export function useSession() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [doc, setDoc] = useState<ReadingDocument | null>(null);
  const [live, setLive] = useState<LiveWord>({ sentenceId: null, word: -1 });
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const portRef = useRef<ReconnectingPort<UiMessage> | null>(null);
  const follower = useRef(new ClockFollower()).current;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const seg = follower.segment;
      const i = follower.wordIndex(Date.now());
      const w = seg?.words[i]?.sentenceWord ?? -1;
      setLive((prev) =>
        prev.sentenceId === (seg?.sentenceId ?? null) && prev.word === w
          ? prev
          : { sentenceId: seg?.sentenceId ?? null, word: w },
      );
      raf = follower.paused ? 0 : requestAnimationFrame(loop);
    };
    let tab: number | undefined;
    const port = connectWithRetry<UiUpdate, UiMessage>({
      name: PORT.ui,
      onConnect: () => port.post({ type: 'HELLO', tabId: tab }),
      onMessage(m) {
        if (m.type === 'SESSION') setSession(m.session);
        if (m.type === 'DOC') setDoc(m.doc);
        if (m.type === 'NOTICE')
          toast({
            kind: m.notice.kind === 'error' ? 'error' : 'info',
            title: m.notice.message,
            ...(m.notice.detail ? { description: m.notice.detail } : {}),
          });
        if (m.type === 'SYNC') {
          follower.apply(m.event);
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(loop);
        }
      },
    });
    portRef.current = port;
    void targetTabId().then((t) => {
      tab = t;
      setTabId(t);
    });
    return () => {
      cancelAnimationFrame(raf);
      port.close();
    };
  }, [follower]);

  const view = useMemo(
    () => (doc ? docView(doc, session?.settings.skipRules?.announceSkippedCode ?? true) : null),
    [doc, session?.settings.skipRules?.announceSkippedCode],
  );
  const send = (command: UiCommand) => portRef.current?.post({ type: 'COMMAND', command });
  return {
    session,
    doc: session && doc?.id === session.docId ? doc : null,
    view,
    live,
    tabId,
    send,
  };
}
