import { describe, expect, it } from 'vitest';
import { defaultVoice, engineName, fallbackLadder, switchMessage } from '@/core/tts/fallback';

const installed = [
  { engineId: 'kokoro', modelId: 'kokoro-82m' },
  { engineId: 'piper', modelId: 'piper-en_US-lessac-high' },
  { engineId: 'piper', modelId: 'piper-en_US-lessac-medium' },
];

describe('fallbackLadder', () => {
  it('Kokoro on WebGPU → Kokoro on WASM → Piper voices → system voices', () => {
    expect(
      fallbackLadder({ engineId: 'kokoro', modelId: 'kokoro-82m', backend: 'webgpu' }, installed, {
        system: true,
      }),
    ).toEqual([
      { engineId: 'kokoro', modelId: 'kokoro-82m', backend: 'wasm' },
      { engineId: 'piper', modelId: 'piper-en_US-lessac-high', voice: 'en_US-lessac-high' },
      { engineId: 'piper', modelId: 'piper-en_US-lessac-medium', voice: 'en_US-lessac-medium' },
      { engineId: 'system', voice: '' },
    ]);
  });

  it('Piper on WASM falls back to Kokoro, the other Piper voice, then nothing without system voices', () => {
    expect(
      fallbackLadder(
        { engineId: 'piper', modelId: 'piper-en_US-lessac-high', backend: 'wasm' },
        installed,
        { system: false },
      ),
    ).toEqual([
      { engineId: 'kokoro', modelId: 'kokoro-82m', voice: 'af_heart' },
      { engineId: 'piper', modelId: 'piper-en_US-lessac-medium', voice: 'en_US-lessac-medium' },
    ]);
  });

  it('system voices and the test engine have no render rungs', () => {
    expect(fallbackLadder({ engineId: 'system' }, [], { system: true })).toEqual([]);
    expect(fallbackLadder({ engineId: 'test' }, [], { system: false })).toEqual([]);
  });
});

describe('switch messages', () => {
  it('names what failed and what took over', () => {
    expect(switchMessage({ engineId: 'kokoro' }, { engineId: 'kokoro', backend: 'wasm' })).toBe(
      'Switched Kokoro to WASM because WebGPU failed.',
    );
    expect(switchMessage({ engineId: 'kokoro', backend: 'webgpu' }, { engineId: 'piper' })).toBe(
      'Switched to Piper because WebGPU failed.',
    );
    expect(switchMessage({ engineId: 'piper', backend: 'wasm' }, { engineId: 'system' })).toBe(
      'Switched to system voices because Piper failed.',
    );
    expect(switchMessage({ engineId: 'test' }, { engineId: 'system' })).toBe(
      'Switched to system voices because test voice failed.',
    );
    expect(engineName('elevenlabs')).toBe('elevenlabs');
    expect(defaultVoice('system')).toBe('');
    expect(defaultVoice('piper')).toBe('');
  });
});
