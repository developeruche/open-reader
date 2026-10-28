import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Kbd,
  Progress,
  Tabs,
  Toggle,
  TooltipProvider,
} from '@/ui/components';

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('Button', () => {
  it('defaults to type=button and fires onClick', async () => {
    const onClick = vi.fn();
    wrap(<Button onClick={onClick}>Install</Button>);
    const b = screen.getByRole('button', { name: 'Install' });
    expect(b.getAttribute('type')).toBe('button');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    wrap(
      <Button disabled onClick={onClick}>
        Install
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('uses the label as its accessible name', () => {
    wrap(
      <IconButton label="Next sentence">
        <svg aria-hidden />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Next sentence' })).toBeTruthy();
  });
});

describe('Toggle', () => {
  function Harness() {
    const [on, setOn] = useState(false);
    return <Toggle label="Follow the voice" checked={on} onCheckedChange={setOn} />;
  }

  it('is a labelled switch that shows its state in words', async () => {
    wrap(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Follow the voice' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off')).toBeTruthy();
    await userEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('On')).toBeTruthy();
  });

  it('toggles with the keyboard', async () => {
    wrap(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Follow the voice' });
    sw.focus();
    await userEvent.keyboard(' ');
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Tabs', () => {
  it('switches panels with arrow keys', async () => {
    wrap(
      <Tabs
        label="Views"
        items={[
          { value: 'reader', label: 'Reader', content: <p>reader panel</p> },
          { value: 'outline', label: 'Outline', content: <p>outline panel</p> },
        ]}
      />,
    );
    expect(screen.getByText('reader panel')).toBeTruthy();
    screen.getByRole('tab', { name: 'Reader' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Outline' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('outline panel')).toBeTruthy();
  });
});

describe('Progress, Badge, Kbd, EmptyState', () => {
  it('renders an accessible progressbar', () => {
    wrap(<Progress label="Download" value={0.42} />);
    const p = screen.getByRole('progressbar', { name: 'Download' });
    expect(p.getAttribute('aria-valuenow')).toBe('42');
  });

  it('renders badges, keys and empty states', () => {
    wrap(
      <>
        <Badge>Apache-2.0</Badge>
        <Kbd>Space</Kbd>
        <EmptyState title="No documents yet" body="Open a PDF." />
      </>,
    );
    expect(screen.getByText('Apache-2.0')).toBeTruthy();
    expect(screen.getByText('Space').tagName).toBe('KBD');
    expect(screen.getByRole('heading', { name: 'No documents yet' })).toBeTruthy();
  });
});
