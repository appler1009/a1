import { useEffect, useState } from 'react';
import { X, Clock, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ScheduledJob {
  id: string;
  userId: string;
  roleId: string;
  description: string;
  scheduleType: 'once' | 'recurring';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  runAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ScheduledJobsDialogProps {
  open: boolean;
  onClose: () => void;
}

function statusColor(status: ScheduledJob['status']): string {
  switch (status) {
    case 'pending': return 'text-blue-400';
    case 'running': return 'text-yellow-400';
    case 'completed': return 'text-green-400';
    case 'failed': return 'text-red-400';
    case 'cancelled': return 'text-muted-foreground';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function ScheduledJobsDialog({ open, onClose }: ScheduledJobsDialogProps) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);

  const fetchJobs = () => {
    setLoading(true);
    setError('');
    apiFetch('/api/scheduled-jobs')
      .then(async (res) => {
        const data = await res.json();
        if (!data.success) {
          setError(data.error?.message || 'Failed to load scheduled jobs');
        } else {
          setJobs(data.data);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load scheduled jobs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) fetchJobs();
  }, [open]);

  const handleCancel = async (id: string) => {
    setCancelling(id);
    try {
      const res = await apiFetch(`/api/scheduled-jobs/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'cancelled' } : j));
      } else {
        setError(data.error?.message || 'Failed to cancel job');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    } finally {
      setCancelling(null);
    }
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <Clock className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold flex-1">Scheduled Jobs</h2>
          <button
            onClick={fetchJobs}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && jobs.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading...</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 mb-3">{error}</div>
          )}

          {!loading && jobs.length === 0 && !error && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No scheduled jobs. Ask the AI to schedule a task.
            </p>
          )}

          <div className="space-y-2">
            {jobs.map(job => (
              <div key={job.id} className="border border-border rounded-md p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground mb-1 leading-snug">{job.description}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className={`font-medium ${statusColor(job.status)}`}>{job.status}</span>
                      <span className="capitalize">{job.scheduleType}</span>
                      {job.runAt && <span>Scheduled: {formatDate(job.runAt)}</span>}
                      {job.lastRunAt && <span>Last run: {formatDate(job.lastRunAt)}</span>}
                      {job.runCount > 0 && <span>Runs: {job.runCount}</span>}
                    </div>
                    {job.lastError && (
                      <p className="text-xs text-red-400 mt-1 truncate" title={job.lastError}>
                        Error: {job.lastError}
                      </p>
                    )}
                  </div>
                  {(job.status === 'pending' || job.status === 'failed') && (
                    <button
                      onClick={() => handleCancel(job.id)}
                      disabled={cancelling === job.id}
                      className="p-1 text-muted-foreground hover:text-red-400 hover:bg-muted rounded transition-colors shrink-0"
                      title="Cancel job"
                    >
                      {cancelling === job.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />
                      }
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
