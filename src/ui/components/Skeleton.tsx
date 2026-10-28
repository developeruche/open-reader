import { cn } from '../cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('rounded-control bg-paper-2 motion-safe:animate-pulse', className)}
    />
  );
}
