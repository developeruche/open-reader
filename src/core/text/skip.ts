/** Block-level reading rules (PLAN.md §5.2.2). Skipped blocks stay visible; the voice passes over them. */
import { z } from 'zod';
import type { Block, SkipReason } from '../document/model';
import { DEFAULT_INLINE_SKIPS, type InlineSkipOptions } from './normalize';

export const SkipRulesSchema = z.object({
  codeBlocks: z.enum(['skip', 'read']).default('skip'),
  announceSkippedCode: z.boolean().default(true),
  tables: z.enum(['skip', 'read']).default('skip'),
  imageAlt: z.enum(['skip', 'read']).default('skip'),
  captions: z.enum(['skip', 'read']).default('read'),
  citations: z.enum(['skip', 'read']).default('skip'),
  footnoteMarkers: z.enum(['skip', 'read']).default('skip'),
  urls: z.enum(['skip', 'say']).default('skip'),
  references: z.enum(['skip', 'read']).default('skip'),
  headersFooters: z.enum(['skip', 'read']).default('skip'),
});

export type SkipRules = z.infer<typeof SkipRulesSchema>;

export const DEFAULT_SKIP_RULES: SkipRules = SkipRulesSchema.parse({});

export function inlineSkips(rules: SkipRules): InlineSkipOptions {
  return {
    citations: rules.citations === 'skip',
    footnoteMarkers: rules.footnoteMarkers === 'skip',
    urls: rules.urls ?? DEFAULT_INLINE_SKIPS.urls,
  };
}

/**
 * Applies the rules to a block. Sources may pre-set `skip` (e.g. PDF 'headerFooter', web
 * 'imageAlt'); rules decide whether that reason is honoured.
 */
export function skipReason(block: Block, rules: SkipRules): SkipReason | undefined {
  const preset = block.skip;
  if (preset === 'user') return 'user';
  if (preset === 'headerFooter' || preset === 'pageNumber')
    return rules.headersFooters === 'skip' ? preset : undefined;
  if (preset === 'imageAlt') return rules.imageAlt === 'skip' ? 'imageAlt' : undefined;
  if (preset === 'footnote') return 'footnote';
  switch (block.type) {
    case 'code':
      return rules.codeBlocks === 'skip' ? 'code' : undefined;
    case 'tableRow':
      return rules.tables === 'skip' ? 'table' : undefined;
    case 'reference':
      return rules.references === 'skip' ? 'reference' : undefined;
    case 'caption':
      return rules.captions === 'skip' ? 'imageAlt' : undefined;
    default:
      return preset;
  }
}

export function applySkipRules(blocks: Block[], rules: SkipRules): Block[] {
  return blocks.map((b) => {
    const skip = skipReason(b, rules);
    const { skip: _old, ...rest } = b;
    return skip ? { ...rest, skip } : rest;
  });
}

/** Text the voice says in place of a skipped code block, once per block (when enabled). */
export function skipAnnouncement(block: Block, rules: SkipRules): string | undefined {
  return block.skip === 'code' && rules.announceSkippedCode ? 'Code block skipped.' : undefined;
}
