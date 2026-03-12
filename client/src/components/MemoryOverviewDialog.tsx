import { useEffect, useState } from 'react';
import { X, Brain, Loader2, Trash2, Pencil } from 'lucide-react';
import { DialogOverlay } from './DialogOverlay';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch } from '../lib/api';

interface MemoryOverviewDialogProps {
  role: { id: string; name: string } | null;
  onClose: () => void;
}

export function MemoryOverviewDialog({ role, onClose }: MemoryOverviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!role) return;


    setRemoveError('');

    setEditError('');
    setLoading(true);
    setOverview(null);
    setEmpty(false);
    setError('');

    apiFetch(`/api/roles/${role.id}/memory-overview`)
      .then(async (res) => {
        const data = await res.json();
        if (!data.success) {
          setError(data.error?.message || 'Failed to load memory overview');
        } else if (data.data.empty) {
          setEmpty(true);
        } else {
          setOverview(data.data.overview);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load memory overview');
      })
      .finally(() => setLoading(false));
  }, [role?.id, refreshKey]);

  const handleMouseUp = () => {
    const sel = window.getSelection()?.toString().trim() ?? '';
    setSelectedText(sel);

  };

  const handleMouseDown = () => {
    setSelectedText('');

    setRemoveError('');

    setEditError('');
    setEditInstruction('');
  };

  const handleRemove = async () => {
    if (!role || !selectedText) return;
    setRemoving(true);
    setRemoveError('');

    try {
      const res = await apiFetch(`/api/roles/${role.id}/remove-memories`, {
        method: 'POST',
        body: JSON.stringify({ selection: selectedText }),
      });
      const data = await res.json();
      if (!data.success) {
        setRemoveError(data.error?.message || 'Failed to remove memories');
      } else {
        setSelectedText('');
        window.getSelection()?.removeAllRanges();
        setTimeout(() => setRefreshKey((k) => k + 1), 800);
      }
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove memories');
    } finally {
      setRemoving(false);
    }
  };

  const handleEdit = async () => {
    if (!role || !selectedText || !editInstruction.trim()) return;
    setEditing(true);
    setEditError('');

    try {
      const res = await apiFetch(`/api/roles/${role.id}/edit-memories`, {
        method: 'POST',
        body: JSON.stringify({ selection: selectedText, instruction: editInstruction.trim() }),
      });
      const data = await res.json();
      if (!data.success) {
        setEditError(data.error?.message || 'Failed to edit memories');
      } else {
        setSelectedText('');
        setEditInstruction('');
        window.getSelection()?.removeAllRanges();
        setTimeout(() => setRefreshKey((k) => k + 1), 800);
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to edit memories');
    } finally {
      setEditing(false);
    }
  };

  if (!role) return null;

  return (
    <DialogOverlay onClose={onClose}>
      <div className="bg-card rounded-lg shadow-lg w-[600px] max-w-[90vw] h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold flex-1 truncate">{role.name} — Memory</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-muted rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground pl-7">Summary of stored memories. Select text to edit or remove.</p>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {loading && (
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Generating summary...</span>
            </div>
          )}

          {!loading && error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          {!loading && !error && empty && (
            <p className="text-sm text-muted-foreground">No memory stored for this role yet.</p>
          )}

          {!loading && !error && overview && (
            <div
              className="prose prose-sm dark:prose-invert max-w-none select-text cursor-text"
              onMouseUp={handleMouseUp}
              onMouseDown={handleMouseDown}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{overview}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Sticky footer — always rendered at fixed height to prevent layout shifts during text selection */}
        <div className="border-t border-border px-6 py-3 shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
              placeholder={selectedText ? 'Edit instruction…' : 'Select text above to edit or remove…'}
              disabled={!selectedText}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-muted rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleEdit}
              disabled={editing || removing || !selectedText || !editInstruction.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
            >
              {editing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pencil className="w-3 h-3" />}
              {editing ? 'Editing…' : 'Edit'}
            </button>
            <button
              onClick={handleRemove}
              disabled={removing || editing || !selectedText}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
            >
              {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {removing ? 'Removing…' : 'Remove'}
            </button>
          </div>
          {removeError && <p className="text-xs text-destructive">{removeError}</p>}
          {editError && <p className="text-xs text-destructive">{editError}</p>}
        </div>
      </div>
    </DialogOverlay>
  );
}
