interface PlaceholderShellProps {
  title: string;
}

export function PlaceholderShell({ title }: PlaceholderShellProps) {
  return (
    <main className="min-h-screen bg-paper p-6 text-ink">
      <h1 className="font-serif text-2xl tracking-tight">{title}</h1>
      <p className="mt-2 text-muted">Coming soon.</p>
    </main>
  );
}
