import React, { useState } from 'react';
import { X } from 'lucide-react';
import { DialogOverlay } from './DialogOverlay';

interface CreateRoleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateRole: (name: string, jobDesc?: string) => Promise<void>;
}

export function CreateRoleDialog({ isOpen, onClose, onCreateRole }: CreateRoleDialogProps) {
  const [name, setName] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Role name is required');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await onCreateRole(name.trim(), jobDesc.trim() || undefined);
      setName('');
      setJobDesc('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create role');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <DialogOverlay onClose={onClose}>
      <div className="bg-card rounded-lg shadow-lg w-96 max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Create New Role</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-lg transition-colors"
            disabled={isLoading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="role-name" className="block text-sm font-medium mb-2">
              Role Name
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              Examples: Strata Council, Teacher, Dad, Customer Support, Code Reviewer
            </p>
            <input
              id="role-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter role name..."
              className="w-full bg-muted rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor="role-desc" className="block text-sm font-medium mb-1">
              Role Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Describe your responsibilities, context, or goals for this role.
            </p>
            <textarea
              id="role-desc"
              value={jobDesc}
              onChange={(e) => setJobDesc(e.target.value)}
              placeholder="e.g. I'm a product manager working on a B2B SaaS platform, focused on roadmap planning and stakeholder communication."
              rows={3}
              className="w-full bg-muted rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
              disabled={isLoading || !name.trim()}
            >
              {isLoading ? 'Creating...' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </DialogOverlay>
  );
}
