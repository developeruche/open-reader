/** Model catalogue schema (PLAN.md §6.1), validated at build time and at runtime. */
import { z } from 'zod';

export const EngineIdSchema = z.enum(['kokoro', 'piper', 'system', 'elevenlabs', 'openai', 'test']);
export type EngineId = z.infer<typeof EngineIdSchema>;

export const BackendSchema = z.enum(['webgpu', 'wasm', 'remote']);
export type Backend = z.infer<typeof BackendSchema>;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex characters');

export const ModelFileSchema = z.object({
  path: z.string().min(1),
  url: z.string().url(),
  sha256,
  bytes: z.number().int().positive(),
  backend: z.enum(['webgpu', 'wasm']).optional(),
});

export const VoiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  lang: z.string().min(2),
  gender: z.string().optional(),
  sampleUrl: z.string().optional(),
});

export const ModelManifestSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    engine: EngineIdSchema,
    displayName: z.string().min(1),
    version: z.string().min(1),
    license: z.object({
      spdx: z.string().min(1),
      url: z.string().url(),
      notice: z.string().optional(),
      personalUseOnly: z.boolean().optional(),
    }),
    sizeBytes: z.number().int().nonnegative(),
    sampleRate: z.number().int().positive(),
    files: z.array(ModelFileSchema),
    voices: z.array(VoiceSchema).min(1),
    defaultVoice: z.string(),
    caps: z.object({
      wordTimings: z.enum(['native', 'estimated']),
      backends: z.array(BackendSchema).min(1),
    }),
  })
  .refine((m) => m.voices.some((v) => v.id === m.defaultVoice), {
    message: 'defaultVoice must be one of voices',
    path: ['defaultVoice'],
  })
  .refine((m) => m.files.reduce((a, f) => a + f.bytes, 0) <= m.sizeBytes || m.files.length === 0, {
    message: 'sizeBytes must cover all files',
    path: ['sizeBytes'],
  });

export type ModelManifest = z.infer<typeof ModelManifestSchema>;
export type VoiceInfo = z.infer<typeof VoiceSchema>;

export const RegistrySchema = z
  .object({ version: z.literal(1), models: z.array(ModelManifestSchema) })
  .refine((r) => new Set(r.models.map((m) => m.id)).size === r.models.length, {
    message: 'model ids must be unique',
  });

export type Registry = z.infer<typeof RegistrySchema>;
