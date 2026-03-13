import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleDescriptionDialog } from '../../components/RoleDescriptionDialog';

const WORD_LIMIT = 100;
const WARN_THRESHOLD = 80;

function makeRole(overrides: Partial<{ id: string; name: string; jobDesc: string }> = {}) {
  return { id: 'role-1', name: 'Developer', ...overrides };
}

/** Build a string of exactly `n` space-separated words. */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
}

describe('RoleDescriptionDialog', () => {
  it('renders nothing when role is null', () => {
    const { container } = render(
      <RoleDescriptionDialog role={null} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog with the role name as the label', () => {
    render(
      <RoleDescriptionDialog role={makeRole({ name: 'Support Agent' })} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByText('Support Agent')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /role description/i })).toBeInTheDocument();
  });

  it('pre-populates textarea with the existing jobDesc', () => {
    render(
      <RoleDescriptionDialog
        role={makeRole({ jobDesc: 'Handles customer tickets' })}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('Handles customer tickets');
  });

  it('initializes with empty textarea when jobDesc is undefined', () => {
    render(
      <RoleDescriptionDialog role={makeRole()} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('does not show word count below the warning threshold', () => {
    render(
      <RoleDescriptionDialog
        role={makeRole({ jobDesc: words(WARN_THRESHOLD - 1) })}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText(/\/\s*100 words/i)).toBeNull();
  });

  it('shows word count at the warning threshold', () => {
    render(
      <RoleDescriptionDialog
        role={makeRole({ jobDesc: words(WARN_THRESHOLD) })}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(`${WARN_THRESHOLD} / ${WORD_LIMIT} words`)).toBeInTheDocument();
  });

  it('shows word count in red when over the limit', () => {
    const overLimitText = words(WORD_LIMIT + 1);
    render(
      <RoleDescriptionDialog
        role={makeRole({ jobDesc: overLimitText })}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    // Component allows jobDesc to be displayed (editing a pre-existing over-limit value),
    // but the count indicator should signal destructive state.
    const counter = screen.getByText(/\/\s*100 words/i);
    expect(counter.className).toContain('text-destructive');
  });

  it('Save button is disabled when word count exceeds the limit', () => {
    render(
      <RoleDescriptionDialog
        role={makeRole({ jobDesc: words(WORD_LIMIT + 1) })}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('Save button is enabled within the word limit', () => {
    render(
      <RoleDescriptionDialog
        role={makeRole({ jobDesc: 'Short text' })}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  it('calls onSave with roleId and text, then onClose on success', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <RoleDescriptionDialog
        role={makeRole({ id: 'role-99', jobDesc: 'Initial text' })}
        onClose={onClose}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('role-99', 'Initial text'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows "Saving…" and disables controls while saving', async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onSave = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveSave = r; }),
    );
    render(
      <RoleDescriptionDialog role={makeRole({ jobDesc: 'Some text' })} onClose={vi.fn()} onSave={onSave} />,
    );
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument());
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    resolveSave();
  });

  it('Cancel button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RoleDescriptionDialog role={makeRole()} onClose={onClose} onSave={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key calls onClose via DialogOverlay', () => {
    const onClose = vi.fn();
    render(<RoleDescriptionDialog role={makeRole()} onClose={onClose} onSave={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks typing a new word when already at the limit', async () => {
    const user = userEvent.setup();
    render(
      <RoleDescriptionDialog
        role={makeRole({ jobDesc: words(WORD_LIMIT) })}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox');

    // Attempt to type a space then a new word — the word itself should be blocked
    await user.type(textarea, ' extraword');

    // The new word should not have been accepted
    expect((textarea as HTMLTextAreaElement).value).not.toContain('extraword');
  });
});
