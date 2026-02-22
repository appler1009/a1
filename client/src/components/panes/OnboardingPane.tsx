import { useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useRolesStore } from '../../store';
import { CreateRoleDialog } from '../CreateRoleDialog';
import { apiFetch } from '../../lib/api';

export function OnboardingPane() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const { addRole, setCurrentRole } = useRolesStore();

  const handleCreateRole = async (name: string) => {
    try {
      const response = await apiFetch('/api/roles', {
        method: 'POST',
        body: JSON.stringify({
          name,
          groupId: undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create role');
      }

      const data = await response.json();
      if (data.success) {
        console.log('[Onboarding] ✓ Created role:', data.data.name, data.data.id);
        addRole(data.data);
        setCurrentRole(data.data);
      } else {
        throw new Error(data.error?.message || 'Failed to create role');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create role';
      console.error('[Onboarding] Failed to create role:', message);
      throw error;
    }
  };

  return (
    <>
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
        <div className="text-center max-w-2xl px-6 space-y-8">
          {/* Icon */}
          <div className="inline-block p-4 rounded-full bg-gradient-to-br from-primary/20 to-blue-500/20">
            <Sparkles className="w-12 h-12 text-primary" />
          </div>

          {/* Heading */}
          <div className="space-y-3">
            <h1 className="text-4xl font-bold">Welcome to a1</h1>
            <p className="text-xl text-muted-foreground">
              Create a role to get started. A role is like a persona or context for your conversations.
            </p>
          </div>

          {/* Examples */}
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground font-medium">
              Here are some examples you might create:
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
              {[
                { icon: '👨‍⚖️', name: 'Strata Council' },
                { icon: '🎓', name: 'Teacher' },
                { icon: '👨‍💼', name: 'Business Advisor' },
                { icon: '💻', name: 'Code Reviewer' },
                { icon: '🏠', name: 'Dad' },
                { icon: '📞', name: 'Customer Support' },
              ].map((example) => (
                <div
                  key={example.name}
                  className="p-3 rounded-lg bg-muted/50 border border-border/50 hover:border-border transition-colors"
                >
                  <div className="text-2xl mb-1">{example.icon}</div>
                  <div className="text-sm font-medium">{example.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* CTA Button */}
          <div className="space-y-4 pt-4">
            <button
              onClick={() => setIsCreateDialogOpen(true)}
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-primary to-blue-600 text-primary-foreground rounded-lg hover:opacity-90 transition-opacity font-semibold text-lg shadow-lg hover:shadow-xl"
            >
              <Plus className="w-5 h-5" />
              Create Your First Role
            </button>

            <p className="text-xs text-muted-foreground">
              You can create multiple roles and switch between them anytime
            </p>
          </div>

          {/* Feature highlights */}
          <div className="grid grid-cols-3 gap-4 pt-8 max-w-md mx-auto text-sm">
            <div className="space-y-2">
              <div className="text-2xl">💬</div>
              <p className="text-muted-foreground">Organize conversations by context</p>
            </div>
            <div className="space-y-2">
              <div className="text-2xl">💾</div>
              <p className="text-muted-foreground">Keep history separate per role</p>
            </div>
            <div className="space-y-2">
              <div className="text-2xl">⚡</div>
              <p className="text-muted-foreground">Switch instantly between roles</p>
            </div>
          </div>
        </div>
      </div>

      {/* Create Role Dialog */}
      <CreateRoleDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreateRole={handleCreateRole}
      />
    </>
  );
}
