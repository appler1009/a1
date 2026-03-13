import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduledJobsDialog } from '../../components/ScheduledJobsDialog';
import { apiFetch } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn(),
}));

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

function makeJob(overrides: Partial<{
  id: string;
  roleId: string;
  description: string;
  scheduleType: 'once' | 'recurring';
  status: JobStatus;
  runAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  holdUntil: string | null;
  runCount: number;
}> = {}) {
  return {
    id: 'job-1',
    userId: 'user-1',
    roleId: 'role-1',
    description: 'Run weekly report',
    scheduleType: 'recurring' as const,
    status: 'pending' as JobStatus,
    runAt: '2024-03-01T10:00:00Z',
    lastRunAt: null,
    lastError: null,
    holdUntil: null,
    runCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

const ROLES_RESPONSE = { success: true, data: { roles: [{ id: 'role-1', name: 'Developer' }] } };
const EMPTY_JOBS_RESPONSE = { success: true, data: [] };

/** Configure apiFetch mock: jobs API → jobsData, roles API → rolesData */
function mockFetch(jobsData: unknown, rolesData = ROLES_RESPONSE) {
  vi.mocked(apiFetch).mockImplementation((input) => {
    const url = input.toString();
    const data = url.includes('scheduled-jobs') && !url.includes('job-')
      ? jobsData
      : rolesData;
    return Promise.resolve({
      json: () => Promise.resolve(data),
    } as Response);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ScheduledJobsDialog', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(<ScheduledJobsDialog open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the "Scheduled Jobs" heading when open', async () => {
    mockFetch(EMPTY_JOBS_RESPONSE);
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    expect(screen.getByText('Scheduled Jobs')).toBeInTheDocument();
  });

  it('fetches jobs on open', async () => {
    mockFetch(EMPTY_JOBS_RESPONSE);
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/scheduled-jobs'));
    await waitFor(() => expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/roles'));
  });

  it('shows empty state when no jobs are returned', async () => {
    mockFetch(EMPTY_JOBS_RESPONSE);
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/no scheduled jobs/i)).toBeInTheDocument(),
    );
  });

  it('renders job descriptions in the list', async () => {
    mockFetch({ success: true, data: [makeJob({ description: 'Send daily summary' })] });
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Send daily summary')).toBeInTheDocument());
  });

  it('shows the resolved role name alongside the job', async () => {
    mockFetch({ success: true, data: [makeJob({ roleId: 'role-1' })] });
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Developer')).toBeInTheDocument());
  });

  it('renders the job status text', async () => {
    mockFetch({ success: true, data: [makeJob({ status: 'completed' })] });
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
  });

  it('shows last error text when present', async () => {
    mockFetch({
      success: true,
      data: [makeJob({ status: 'failed', lastError: 'Timeout after 30s' })],
    });
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/timeout after 30s/i)).toBeInTheDocument());
  });

  it('shows an error banner when the API returns success=false', async () => {
    mockFetch({ success: false, error: { message: 'Unauthorized' } });
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Unauthorized')).toBeInTheDocument());
  });

  it('shows an error banner when the fetch rejects', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });

  describe('cancel button visibility', () => {
    it.each<JobStatus>(['pending', 'failed'])(
      'shows cancel button for %s jobs',
      async (status) => {
        mockFetch({ success: true, data: [makeJob({ id: 'job-1', status })] });
        render(<ScheduledJobsDialog open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText(status));
        expect(screen.getByTitle('Cancel job')).toBeInTheDocument();
      },
    );

    it.each<JobStatus>(['running', 'completed', 'cancelled'])(
      'hides cancel button for %s jobs',
      async (status) => {
        mockFetch({ success: true, data: [makeJob({ id: 'job-1', status })] });
        render(<ScheduledJobsDialog open onClose={vi.fn()} />);
        await waitFor(() => screen.getByText(status));
        expect(screen.queryByTitle('Cancel job')).toBeNull();
      },
    );
  });

  it('clicking cancel calls DELETE and updates job status to cancelled', async () => {
    const user = userEvent.setup();
    mockFetch({ success: true, data: [makeJob({ id: 'job-42', status: 'pending' })] });
    // Mock the DELETE call
    vi.mocked(apiFetch).mockImplementation((input) => {
      const url = input.toString();
      if (url.includes('job-42')) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) } as Response);
      }
      const data = url.includes('scheduled-jobs')
        ? { success: true, data: [makeJob({ id: 'job-42', status: 'pending' })] }
        : ROLES_RESPONSE;
      return Promise.resolve({ json: () => Promise.resolve(data) } as Response);
    });

    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => screen.getByTitle('Cancel job'));

    await user.click(screen.getByTitle('Cancel job'));

    await waitFor(() =>
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/scheduled-jobs/job-42', {
        method: 'DELETE',
      }),
    );
    await waitFor(() => expect(screen.getByText('cancelled')).toBeInTheDocument());
  });

  it('shows error when cancel request fails', async () => {
    const user = userEvent.setup();
    mockFetch({ success: true, data: [makeJob({ id: 'job-42', status: 'pending' })] });
    vi.mocked(apiFetch).mockImplementation((input) => {
      const url = input.toString();
      if (url.includes('job-42')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: false, error: { message: 'Not found' } }),
        } as Response);
      }
      const data = url.includes('scheduled-jobs')
        ? { success: true, data: [makeJob({ id: 'job-42', status: 'pending' })] }
        : ROLES_RESPONSE;
      return Promise.resolve({ json: () => Promise.resolve(data) } as Response);
    });

    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => screen.getByTitle('Cancel job'));
    await user.click(screen.getByTitle('Cancel job'));
    await waitFor(() => expect(screen.getByText('Not found')).toBeInTheDocument());
  });

  it('refresh button re-fetches jobs', async () => {
    const user = userEvent.setup();
    mockFetch(EMPTY_JOBS_RESPONSE);
    render(<ScheduledJobsDialog open onClose={vi.fn()} />);
    await waitFor(() => screen.getByText(/no scheduled jobs/i));

    const callsBefore = vi.mocked(apiFetch).mock.calls.length;
    await user.click(screen.getByTitle('Refresh'));
    await waitFor(() =>
      expect(vi.mocked(apiFetch).mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it('close button calls onClose', async () => {
    const user = userEvent.setup();
    mockFetch(EMPTY_JOBS_RESPONSE);
    const onClose = vi.fn();
    render(<ScheduledJobsDialog open onClose={onClose} />);
    await waitFor(() => screen.getByText(/no scheduled jobs/i));
    // The X button is next to the Refresh button in the header
    const headerButtons = screen.getAllByRole('button');
    // The X close button is the last button in the header (after Refresh)
    await user.click(headerButtons[headerButtons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key calls onClose via DialogOverlay', async () => {
    mockFetch(EMPTY_JOBS_RESPONSE);
    const onClose = vi.fn();
    render(<ScheduledJobsDialog open onClose={onClose} />);
    await waitFor(() => screen.getByText('Scheduled Jobs'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
