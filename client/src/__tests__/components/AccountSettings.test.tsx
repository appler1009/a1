import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountSettings } from '../../components/settings/AccountSettings';
import { apiFetch } from '../../lib/api';
import { useAuthStore } from '../../store';
import { useRolesStore } from '../../store/roles';

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../../store', () => ({ useAuthStore: vi.fn() }));
vi.mock('../../store/roles', () => ({ useRolesStore: vi.fn() }));

const mockRoles = [
  { id: 'role-1', name: 'Assistant' },
  { id: 'role-2', name: 'Developer' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuthStore).mockReturnValue({
    user: { id: 'u1', email: 'a@b.com', name: 'Alice', primaryRoleId: null },
  } as any);
  vi.mocked(useRolesStore).mockReturnValue({ roles: mockRoles } as any);
});

describe('AccountSettings — sandbox banner', () => {
  it('does not show the banner for regular users', () => {
    render(<AccountSettings />);
    expect(screen.queryByText('Sandbox account')).toBeNull();
  });

  it('shows the sandbox banner when user.sandboxUser is true', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', sandboxUser: true },
    } as any);
    render(<AccountSettings />);
    expect(screen.getByText('Sandbox account')).toBeTruthy();
  });
});

describe('AccountSettings — primary role selector', () => {
  it('does not show a "No default" option', () => {
    render(<AccountSettings />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('No default');
  });

  it('pre-selects the first role when user has no primaryRoleId', () => {
    render(<AccountSettings />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('role-1');
  });

  it('pre-selects the user primaryRoleId when set', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      user: { id: 'u1', email: 'a@b.com', name: 'Alice', primaryRoleId: 'role-2' },
    } as any);
    render(<AccountSettings />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('role-2');
  });

  it('hides the role selector when no roles exist', () => {
    vi.mocked(useRolesStore).mockReturnValue({ roles: [] } as any);
    render(<AccountSettings />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('saves selected role on submit', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { user: {} } }),
    } as Response);

    render(<AccountSettings />);
    await user.selectOptions(screen.getByRole('combobox'), 'role-2');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/auth/me',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"primaryRoleId":"role-2"'),
        }),
      ),
    );
  });
});
