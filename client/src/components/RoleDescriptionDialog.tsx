import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { countWords } from '@local-agent/shared';

const WORD_LIMIT = 100;
const WORD_WARN_THRESHOLD = 80;

interface RoleDescriptionDialogProps {
  role: { id: string; name: string; jobDesc?: string } | null;
  onClose: () => void;
  onSave: (roleId: string, description: string) => Promise<void>;
}

export function RoleDescriptionDialog({ role, onClose, onSave }: RoleDescriptionDialogProps) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (role) setText(role.jobDesc || '');
  }, [role]);

  const wordCount = countWords(text);
  const overLimit = wordCount > WORD_LIMIT;
  const showCount = wordCount >= WORD_WARN_THRESHOLD;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    // Allow editing but prevent exceeding the limit by adding more words
    const words = value.trim() === '' ? [] : value.trim().split(/\s+/);
    if (words.length <= WORD_LIMIT) {
      setText(value);
    } else {
      // Allow if user is editing within existing words (e.g. mid-word typing)
      // Only block if a new word boundary would push over
      const currentWords = text.trim() === '' ? [] : text.trim().split(/\s+/);
      if (words.length <= currentWords.length) {
        setText(value);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (overLimit) return;
    setSaving(true);
    try {
      await onSave(role!.id, text);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!role) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-lg w-[480px] max-w-[90vw]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">Role Description</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-lg transition-colors"
            disabled={saving}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">{role.name}</label>
            <textarea
              value={text}
              onChange={handleChange}
              placeholder="Describe your role and who you are (e.g. I'm a strata council president managing a 40-unit building. Help me with bylaws, resident issues, and meeting agendas.)"
              className="w-full bg-muted rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              rows={5}
              disabled={saving}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
              }}
            />
            {showCount && (
              <p className={`text-xs mt-1.5 text-right ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                {wordCount} / {WORD_LIMIT} words
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
              disabled={saving || overLimit}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
