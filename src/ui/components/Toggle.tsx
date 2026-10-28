import { Switch } from 'radix-ui';
import { useId, type ReactNode } from 'react';

export interface ToggleProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  disabled?: boolean;
}

/** An on/off switch with a visible label and an on/off word (state is never shown by colour alone). */
export function Toggle({ label, description, checked, onCheckedChange, disabled }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-6 text-right text-xs text-muted tabular">
          {checked ? 'On' : 'Off'}
        </span>
        <Switch.Root
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          className="relative h-6 w-10 shrink-0 rounded-full border border-ink bg-paper transition-quiet data-[state=checked]:bg-ink disabled:opacity-40"
        >
          <Switch.Thumb className="block size-4 translate-x-[3px] rounded-full bg-ink transition-quiet data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-paper" />
        </Switch.Root>
      </div>
    </div>
  );
}
