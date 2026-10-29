/** Reading rules for one document (PLAN.md M11), over the defaults from Settings. */
import type { SkipRules } from '@/core/text/skip';
import { Button, Toggle } from '../components';

type RuleKey = Exclude<keyof SkipRules, 'announceSkippedCode'>;

const LABELS: Record<RuleKey, string> = {
  codeBlocks: 'Skip code blocks',
  tables: 'Skip tables',
  imageAlt: 'Skip image descriptions',
  captions: 'Skip figure captions',
  citations: 'Skip citations like [12]',
  footnoteMarkers: 'Skip footnote markers',
  urls: 'Skip web addresses',
  references: 'Skip references',
  headersFooters: 'Skip headers and footers',
};

export const WEB_RULES: RuleKey[] = ['codeBlocks', 'tables', 'citations', 'urls', 'references'];
export const PDF_RULES: RuleKey[] = ['headersFooters', 'references', 'captions', 'citations'];

export function DocRules({
  rules,
  custom,
  keys,
  onChange,
}: {
  rules: SkipRules;
  /** True when this document has its own rules. */
  custom: boolean;
  keys: RuleKey[];
  onChange(rules: SkipRules | null): void;
}) {
  return (
    <section aria-labelledby="doc-rules" className="flex flex-col">
      <h2 id="doc-rules" className="text-[13px] text-muted">
        Rules for this document
      </h2>
      <div className="divide-y divide-line">
        {keys.map((k) => (
          <Toggle
            key={k}
            label={LABELS[k]}
            checked={rules[k] === 'skip'}
            onCheckedChange={(v) =>
              onChange({ ...rules, [k]: v ? 'skip' : k === 'urls' ? 'say' : 'read' } as SkipRules)
            }
          />
        ))}
      </div>
      {custom ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 self-start"
          onClick={() => onChange(null)}
        >
          Use my default rules
        </Button>
      ) : null}
    </section>
  );
}
