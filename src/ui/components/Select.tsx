import { Select as S } from 'radix-ui';
import { useId } from 'react';
import { Check, ChevronDown } from '../icons';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange(value: string): void;
  hideLabel?: boolean;
}

export function Select({ label, value, options, onValueChange, hideLabel }: SelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <S.Root value={value} onValueChange={onValueChange}>
        <span className={hideLabel ? 'visually-hidden' : 'text-[13px] text-muted'} id={id}>
          {label}
        </span>
        <S.Trigger
          aria-labelledby={id}
          className="inline-flex h-9 min-w-40 items-center justify-between gap-2 rounded-control border border-line bg-paper px-3 text-sm text-ink transition-quiet hover:bg-hover"
        >
          <S.Value />
          <S.Icon>
            <ChevronDown size={16} aria-hidden />
          </S.Icon>
        </S.Trigger>
        <S.Portal>
          <S.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-control border border-line bg-paper p-1 shadow-float"
          >
            <S.Viewport>
              {options.map((o) => (
                <S.Item
                  key={o.value}
                  value={o.value}
                  className="relative flex h-8 items-center gap-2 rounded-[4px] pr-2 pl-7 text-sm text-ink outline-none data-[highlighted]:bg-hover"
                >
                  <S.ItemIndicator className="absolute left-2">
                    <Check size={14} aria-hidden />
                  </S.ItemIndicator>
                  <S.ItemText>{o.label}</S.ItemText>
                  {o.hint ? <span className="ml-auto text-xs text-muted">{o.hint}</span> : null}
                </S.Item>
              ))}
            </S.Viewport>
          </S.Content>
        </S.Portal>
      </S.Root>
    </div>
  );
}
