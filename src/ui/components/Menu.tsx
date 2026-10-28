import { DropdownMenu as M } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect(): void;
  shortcut?: string;
}

export function Menu({ trigger, items }: { trigger: ReactElement; items: MenuItem[] }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-control border border-line bg-paper p-1 shadow-float"
        >
          {items.map((i) => (
            <M.Item
              key={i.label}
              onSelect={i.onSelect}
              className="flex h-8 items-center gap-2 rounded-[4px] px-2 text-sm text-ink outline-none data-[highlighted]:bg-hover"
            >
              {i.icon}
              <span className="flex-1">{i.label}</span>
              {i.shortcut ? (
                <span className="font-mono text-[11px] text-muted">{i.shortcut}</span>
              ) : null}
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
