/** TtsApi for the offscreen host: forwards to the background over the engine-host port. */
import type { HostEvent } from '@/runtime/protocol';
import type { TtsApi, TtsEvent } from './tts';

export class RemoteTts implements TtsApi {
  private nextId = 1;
  private readonly handlers = new Map<number, (e: TtsEvent) => void>();

  constructor(private readonly post: (e: HostEvent) => void) {}

  speak(
    text: string,
    options: Parameters<TtsApi['speak']>[1],
    onEvent: (e: TtsEvent) => void,
  ): void {
    const id = this.nextId++;
    this.handlers.clear(); // a new utterance replaces the old one
    this.handlers.set(id, onEvent);
    this.post({ type: 'TTS', op: 'speak', id, text, options });
  }

  pause(): void {
    this.post({ type: 'TTS', op: 'pause' });
  }

  resume(): void {
    this.post({ type: 'TTS', op: 'resume' });
  }

  stop(): void {
    this.post({ type: 'TTS', op: 'stop' });
  }

  async getVoices() {
    return [];
  }

  /** Called with TTS_EVENT commands from the background. */
  deliver(id: number, e: TtsEvent): void {
    this.handlers.get(id)?.(e);
  }
}
