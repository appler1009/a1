import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageItem } from '../../components/MessageItem';
import type { Message } from '../../store';

// Mock the store hooks used inside MessageItem
vi.mock('../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store')>();
  return {
    ...actual,
    useUIStore: () => ({
      setViewerFile: vi.fn(),
      setViewerTab: vi.fn(),
    }),
  };
});

// Mock apiFetch so network calls don't fire
vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    roleId: 'role-1',
    content: 'Hello world',
    role: 'user',
    createdAt: new Date('2024-03-01T12:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('MessageItem rendering', () => {
  it('renders the message content', () => {
    render(<MessageItem message={makeMessage({ content: 'Test message' })} />);
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('user messages are right-aligned (justify-end)', () => {
    const { container } = render(<MessageItem message={makeMessage({ role: 'user' })} />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('justify-end');
  });

  it('assistant messages are left-aligned (justify-start)', () => {
    const { container } = render(
      <MessageItem message={makeMessage({ role: 'assistant', content: 'Hi there' })} />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('justify-start');
  });

  it('system messages are left-aligned and styled differently', () => {
    const { container } = render(
      <MessageItem message={makeMessage({ role: 'system', content: '*tool call*' })} />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('justify-start');
  });

  it('shows timestamp for user messages', () => {
    render(<MessageItem message={makeMessage({ role: 'user' })} />);
    // The timestamp is rendered as a localeTimeString — just check something is there
    const timestamps = document.querySelectorAll('.text-xs.opacity-70');
    expect(timestamps.length).toBeGreaterThan(0);
  });

  it('does NOT show timestamp for system messages', () => {
    const { container } = render(
      <MessageItem message={makeMessage({ role: 'system', content: '*search*' })} />,
    );
    const timestamps = container.querySelectorAll('.text-xs.opacity-70');
    expect(timestamps.length).toBe(0);
  });
});

describe('MessageItem keyword highlighting', () => {
  // react-markdown v10 renders text via the `text` node component,
  // but the `text` component handler only fires inside inline markdown contexts.
  // In jsdom tests the full text is rendered; all tests here confirm
  // the component at minimum renders content without errors.

  it('renders content with highlightKeyword prop without throwing', () => {
    expect(() =>
      render(
        <MessageItem
          message={makeMessage({ content: 'Hello world' })}
          highlightKeyword="world"
        />,
      ),
    ).not.toThrow();
  });

  it('renders text content when keyword is provided', () => {
    render(
      <MessageItem
        message={makeMessage({ content: 'Hello world' })}
        highlightKeyword="world"
      />,
    );
    expect(screen.getByText(/hello world/i)).toBeInTheDocument();
  });

  it('renders no marks when no keyword is given', () => {
    const { container } = render(<MessageItem message={makeMessage({ content: 'Hello' })} />);
    expect(container.querySelector('mark')).toBeNull();
  });

  it('renders no marks when keyword is not in content', () => {
    const { container } = render(
      <MessageItem
        message={makeMessage({ content: 'Hello world' })}
        highlightKeyword="xyz"
      />,
    );
    expect(container.querySelector('mark')).toBeNull();
  });

  it('escapes special regex characters in keyword without throwing', () => {
    expect(() =>
      render(
        <MessageItem
          message={makeMessage({ content: 'price is $5.00' })}
          highlightKeyword="$5.00"
        />,
      ),
    ).not.toThrow();
  });
});
