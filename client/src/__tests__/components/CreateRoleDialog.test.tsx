import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateRoleDialog } from '../../components/CreateRoleDialog';

describe('CreateRoleDialog', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <CreateRoleDialog isOpen={false} onClose={vi.fn()} onCreateRole={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog when isOpen is true', () => {
    render(<CreateRoleDialog isOpen onClose={vi.fn()} onCreateRole={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /create new role/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/role name/i)).toBeInTheDocument();
  });

  it('Create Role button is disabled when the input is empty', () => {
    render(<CreateRoleDialog isOpen onClose={vi.fn()} onCreateRole={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create role/i })).toBeDisabled();
  });

  it('Create Role button is disabled when input is only whitespace', async () => {
    const user = userEvent.setup();
    render(<CreateRoleDialog isOpen onClose={vi.fn()} onCreateRole={vi.fn()} />);
    await user.type(screen.getByLabelText(/role name/i), '   ');
    expect(screen.getByRole('button', { name: /create role/i })).toBeDisabled();
  });

  it('Create Role button enables when a non-empty name is typed', async () => {
    const user = userEvent.setup();
    render(<CreateRoleDialog isOpen onClose={vi.fn()} onCreateRole={vi.fn()} />);
    await user.type(screen.getByLabelText(/role name/i), 'Dev');
    expect(screen.getByRole('button', { name: /create role/i })).toBeEnabled();
  });

  it('calls onCreateRole with the trimmed name on submit', async () => {
    const user = userEvent.setup();
    const onCreateRole = vi.fn().mockResolvedValue(undefined);
    render(<CreateRoleDialog isOpen onClose={vi.fn()} onCreateRole={onCreateRole} />);
    await user.type(screen.getByLabelText(/role name/i), '  Developer  ');
    await user.click(screen.getByRole('button', { name: /create role/i }));
    await waitFor(() => expect(onCreateRole).toHaveBeenCalledWith('Developer'));
  });

  it('calls onClose after successful creation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CreateRoleDialog
        isOpen
        onClose={onClose}
        onCreateRole={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await user.type(screen.getByLabelText(/role name/i), 'Developer');
    await user.click(screen.getByRole('button', { name: /create role/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an error message when onCreateRole rejects', async () => {
    const user = userEvent.setup();
    render(
      <CreateRoleDialog
        isOpen
        onClose={vi.fn()}
        onCreateRole={vi.fn().mockRejectedValue(new Error('Name already taken'))}
      />,
    );
    await user.type(screen.getByLabelText(/role name/i), 'Dev');
    await user.click(screen.getByRole('button', { name: /create role/i }));
    await waitFor(() => expect(screen.getByText('Name already taken')).toBeInTheDocument());
  });

  it('shows a generic error for non-Error rejections', async () => {
    const user = userEvent.setup();
    render(
      <CreateRoleDialog
        isOpen
        onClose={vi.fn()}
        onCreateRole={vi.fn().mockRejectedValue('oops')}
      />,
    );
    await user.type(screen.getByLabelText(/role name/i), 'Dev');
    await user.click(screen.getByRole('button', { name: /create role/i }));
    await waitFor(() => expect(screen.getByText('Failed to create role')).toBeInTheDocument());
  });

  it('shows "Creating..." and disables buttons while submitting', async () => {
    const user = userEvent.setup();
    let resolveCreate!: () => void;
    const onCreateRole = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveCreate = r; }),
    );
    render(<CreateRoleDialog isOpen onClose={vi.fn()} onCreateRole={onCreateRole} />);
    await user.type(screen.getByLabelText(/role name/i), 'Dev');
    await user.click(screen.getByRole('button', { name: /create role/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /creating/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    resolveCreate();
  });

  it('Cancel button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CreateRoleDialog isOpen onClose={onClose} onCreateRole={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('X button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CreateRoleDialog isOpen onClose={onClose} onCreateRole={vi.fn()} />);
    // X button in the header (no accessible name, use title query as fallback)
    const closeButton = screen.getAllByRole('button').find(
      (b) => !b.textContent?.trim(),
    )!;
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key calls onClose via DialogOverlay', () => {
    const onClose = vi.fn();
    render(<CreateRoleDialog isOpen onClose={onClose} onCreateRole={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
