import { Tabs as T } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  label: string;
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?(value: string): void;
  className?: string;
  panelClassName?: string;
}

export function Tabs({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  className,
  panelClassName,
}: TabsProps) {
  return (
    <T.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      className={cn('flex min-h-0 flex-col', className)}
    >
      <T.List aria-label={label} className="flex shrink-0 gap-5 border-b border-line px-4">
        {items.map((i) => (
          <T.Trigger
            key={i.value}
            value={i.value}
            className="relative -mb-px h-10 border-b-2 border-transparent text-sm text-muted transition-quiet hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
          >
            {i.label}
          </T.Trigger>
        ))}
      </T.List>
      {items.map((i) => (
        <T.Content
          key={i.value}
          value={i.value}
          className={cn(
            'min-h-0 flex-1 overscroll-contain focus-visible:outline-offset-[-2px]',
            panelClassName,
          )}
        >
          {i.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
