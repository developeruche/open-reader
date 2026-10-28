import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-10">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <h2 className="font-serif text-lg tracking-tight text-ink">{title}</h2>
      {body ? <p className="max-w-[46ch] text-sm text-ink-2">{body}</p> : null}
      {action}
    </div>
  );
}
