import { useId } from 'react';
import { cn } from '../cn';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  hint?: string;
  error?: string;
  name: string;
  className?: string;
  /** Codes, spellings and regular expressions: no spellcheck or autocorrect. */
  literal?: boolean;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  name,
  className,
  literal,
}: TextFieldProps) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] text-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={literal ? false : undefined}
        autoCapitalize={literal ? 'off' : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-control border border-line bg-paper px-3 text-sm text-ink transition-quiet placeholder:text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-invalid:border-ink"
      />
      {note ? (
        <p id={`${id}-note`} className={cn('text-xs', error ? 'text-ink' : 'text-muted')}>
          {error ? <strong className="font-semibold">{error}</strong> : hint}
        </p>
      ) : null}
    </div>
  );
}
