/**
 * Ring-buffered diagnostics log (PLAN.md §9.2). Entries carry events, states and error messages,
 * never document text: callers log ids, counts and engine errors only.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  source: string;
  message: string;
  detail?: string;
}

export const LOG_CAPACITY = 500;
const MAX_MESSAGE = 300;

export class DiagLog {
  private readonly buf: LogEntry[] = [];
  private dropped = 0;

  constructor(private readonly capacity = LOG_CAPACITY) {}

  push(e: LogEntry): void {
    this.buf.push({
      ...e,
      message: clip(e.message),
      ...(e.detail ? { detail: clip(e.detail) } : {}),
    });
    if (this.buf.length > this.capacity) {
      this.buf.shift();
      this.dropped++;
    }
  }

  entries(): LogEntry[] {
    return [...this.buf];
  }

  get droppedCount(): number {
    return this.dropped;
  }

  clear(): void {
    this.buf.length = 0;
    this.dropped = 0;
  }
}

function clip(s: string): string {
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s;
}

/** Drops secrets (API keys, tokens) from anything exported (§10). */
export function redactSecrets<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (k, v: unknown) =>
      /key|token|secret|password/i.test(k) && typeof v === 'string' ? '[redacted]' : v,
    ),
  ) as T;
}
