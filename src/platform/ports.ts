/** Long-lived runtime ports with automatic reconnection (exponential backoff, §9.2). */
import { browser, type Browser } from 'wxt/browser';

export interface ReconnectingPort<Out> {
  post(msg: Out): void;
  readonly connected: boolean;
  close(): void;
}

export interface PortOptions<In> {
  name: string;
  onMessage(msg: In): void;
  /** Called after every (re)connection, e.g. to say HELLO. */
  onConnect?(): void;
  onDisconnect?(): void;
  maxDelayMs?: number;
}

export function connectWithRetry<In, Out>(o: PortOptions<In>): ReconnectingPort<Out> {
  let port: Browser.runtime.Port | undefined;
  let delay = 100;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: Out[] = [];

  const connect = () => {
    if (closed) return;
    try {
      port = browser.runtime.connect({ name: o.name });
    } catch {
      return retry();
    }
    port.onMessage.addListener((m: unknown) => o.onMessage(m as In));
    port.onDisconnect.addListener(() => {
      port = undefined;
      o.onDisconnect?.();
      retry();
    });
    delay = 100;
    const p = port;
    while (queue.length) p.postMessage(queue.shift());
    // Deferred: callers usually reference the returned handle inside onConnect.
    queueMicrotask(() => o.onConnect?.());
  };
  const retry = () => {
    if (closed) return;
    timer = setTimeout(connect, delay);
    delay = Math.min(o.maxDelayMs ?? 5000, delay * 2);
  };
  connect();
  return {
    post(msg) {
      if (port) {
        try {
          port.postMessage(msg);
          return;
        } catch {
          port = undefined;
        }
      }
      queue.push(msg);
    },
    get connected() {
      return !!port;
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      port?.disconnect();
    },
  };
}
