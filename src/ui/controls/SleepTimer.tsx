/** Sleep timer select (PLAN.md M11): pause after some minutes, or at the end of the section. */
import type { SleepChoice, SleepTimer } from '@/core/player/sleep';
import { Select } from '../components';

const OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
  { value: 'section', label: 'End of section' },
];

const clock = (at: number) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);

export function SleepTimerSelect({
  value,
  onChange,
}: {
  value: SleepTimer | null | undefined;
  onChange(choice: SleepChoice | null): void;
}) {
  // A running minutes timer shows its end time; the select itself offers fresh choices.
  const current = value?.kind === 'section' ? 'section' : value ? 'running' : 'off';
  const options =
    value?.kind === 'minutes'
      ? [{ value: 'running', label: `Until ${clock(value.at)}` }, ...OPTIONS]
      : OPTIONS;
  return (
    <Select
      label="Sleep timer"
      value={current}
      options={options}
      onValueChange={(v) => {
        if (v === 'running') return;
        onChange(
          v === 'off'
            ? null
            : v === 'section'
              ? { kind: 'section' }
              : { kind: 'minutes', minutes: Number(v) },
        );
      }}
    />
  );
}
