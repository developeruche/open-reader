/** User settings (chrome.storage.local), zod-validated with versioned migrations (PLAN.md §4.4). */
import { z } from 'zod';
import { SkipRulesSchema } from './text/skip';

export const VoiceChoiceSchema = z.object({
  engineId: z.enum(['kokoro', 'piper', 'system', 'test', 'elevenlabs', 'openai']),
  modelId: z.string().optional(),
  backend: z.enum(['webgpu', 'wasm']).optional(),
  voice: z.string(),
});
export type VoiceChoice = z.infer<typeof VoiceChoiceSchema>;

export const SettingsSchema = z.object({
  version: z.literal(1),
  voice: VoiceChoiceSchema.nullable().default(null),
  rate: z.number().min(0.5).max(4).default(1),
  pacing: z.enum(['brisk', 'natural', 'relaxed']).default('natural'),
  skipRules: SkipRulesSchema.default(SkipRulesSchema.parse({})),
  cacheCapMB: z.number().int().min(64).max(8192).default(512),
  onboarded: z.boolean().default(false),
  /** Hide and never use voices that need the network (§6.5). */
  strictOffline: z.boolean().default(true),
  /** Open PDF links in the reader instead of Chrome's viewer (§8.1). */
  interceptPdf: z.boolean().default(false),
  /** Number PDF blocks in reading order when the reader opens (Diagnostics, §8.3.8). */
  readingOrderOverlay: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SETTINGS_KEY = 'settings';
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({ version: 1 });

/** Migrates any stored shape to the current version; invalid data falls back to defaults. */
export function migrateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const r = SettingsSchema.safeParse({ version: 1, ...(raw as object) });
  if (r.success) return r.data;
  // Keep every field that is still valid on its own.
  const out: Record<string, unknown> = { version: 1 };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = SettingsSchema.shape[k as keyof typeof SettingsSchema.shape];
    if (field && k !== 'version' && field.safeParse(v).success) out[k] = v;
  }
  return SettingsSchema.parse(out);
}
