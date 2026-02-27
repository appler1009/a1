import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Settings,
  LogOut,
  Plus,
  ChevronDown,
  ChevronRight,
  Users,
  Brain,
  Clock
} from 'lucide-react';
import { useAuthStore, useRolesStore, useUIStore, useEnvironmentStore } from '../store';
import { CreateRoleDialog } from './CreateRoleDialog';
import { MemoryOverviewDialog } from './MemoryOverviewDialog';
import { ScheduledJobsDialog } from './ScheduledJobsDialog';
import { LoadingOverlay } from './LoadingOverlay';
import { apiFetch } from '../lib/api';

export function Sidebar() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [flashRoleId, setFlashRoleId] = useState<string | null>(null);
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
  const [memoryDialogRole, setMemoryDialogRole] = useState<{ id: string; name: string } | null>(null);

  const { user, currentGroup, groups, setCurrentGroup, logout } = useAuthStore();
  const { roles, currentRole, switchRole, addRole } = useRolesStore();
  const { sidebarOpen, toggleSidebar, setShowMcpManager, showScheduledJobs, setShowScheduledJobs, roleSwitching, setRoleSwitching } = useUIStore();
  const environment = useEnvironmentStore((state) => state.environment);

  useEffect(() => {
    if (currentRole?.id) {
      setFlashRoleId(currentRole.id);
      const timer = setTimeout(() => setFlashRoleId(null), 500);
      return () => clearTimeout(timer);
    }
  }, [currentRole?.id]);

  const getEnvironmentBadgeClass = (env?: string) => {
    switch (env) {
      case 'production':
        return 'bg-red-500/20 text-red-500';
      case 'test':
        return 'bg-yellow-500/20 text-yellow-500';
      case 'development':
        return 'bg-blue-500/20 text-blue-500';
      default:
        return 'bg-gray-500/20 text-gray-500';
    }
  };

  const handleCreateRole = async (name: string) => {
    try {
      const response = await apiFetch('/api/roles', {
        method: 'POST',
        body: JSON.stringify({
          name,
          groupId: currentGroup?.id || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create role');
      }

      const data = await response.json();
      if (data.success) {
        console.log('[Sidebar] ✓ Created role:', data.data.name, data.data.id);
        addRole(data.data);
        // Switch to the newly created role
        await switchRole(data.data, setRoleSwitching);
      } else {
        throw new Error(data.error?.message || 'Failed to create role');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create role';
      console.error('[Sidebar] Failed to create role:', message);
      throw error;
    }
  };

  return (
    <>
      {/* Loading overlay for role switching */}
      {roleSwitching && <LoadingOverlay message="Switching role..." />}
      
      <div className={`${sidebarOpen ? 'w-64' : 'w-16'} flex flex-col h-full bg-card border-r border-border transition-all duration-300`}>
      {/* Top Banner - Matching other panes */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border h-11 shrink-0">
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm">a1</span>
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={toggleSidebar}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${sidebarOpen ? '' : '-rotate-90'}`} />
        </button>
      </div>

      {/* Group Selector */}
      {sidebarOpen && groups.length > 0 && (
        <div className="p-4 border-b border-border">
          <label className="text-xs text-muted-foreground mb-1 block">Group</label>
          <select
            value={currentGroup?.id || ''}
            onChange={(e) => {
              const group = groups.find((g) => g.id === e.target.value);
              setCurrentGroup(group || null);
            }}
            className="w-full bg-muted rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Roles */}
      <div className="flex-1 overflow-y-auto p-4">
        {sidebarOpen && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Roles</span>
            <button
              onClick={() => setIsCreateDialogOpen(true)}
              className="p-1 hover:bg-muted rounded-lg transition-colors"
              title="Create role"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="space-y-1">
          {roles
            .filter((r) => !currentGroup || r.groupId === currentGroup.id)
            .map((role) => (
              <div key={role.id}>
                {/* Row */}
                <div className={`flex items-center rounded-lg text-sm transition-colors ${
                  currentRole?.id === role.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                } ${roleSwitching ? 'opacity-50' : ''} ${flashRoleId === role.id ? 'animate-role-activate' : ''}`}>

                  {/* Role switch button */}
                  <button
                    onClick={() => switchRole(role, setRoleSwitching)}
                    disabled={roleSwitching}
                    className="flex items-center gap-2 flex-1 px-3 py-2 text-left min-w-0"
                  >
                    <Users className="w-4 h-4 shrink-0" />
                    {sidebarOpen && <span className="truncate">{role.name}</span>}
                  </button>

                  {/* Chevron toggle (only when sidebar expanded) */}
                  {sidebarOpen && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedRoleId(expandedRoleId === role.id ? null : role.id);
                      }}
                      disabled={roleSwitching}
                      className="px-2 py-2 shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                      title="Role options"
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${
                        expandedRoleId === role.id ? 'rotate-90' : ''
                      }`} />
                    </button>
                  )}
                </div>

                {/* Sub-menu */}
                {sidebarOpen && expandedRoleId === role.id && (
                  <div className="ml-3 mt-0.5 pl-2 border-l border-border">
                    <button
                      onClick={() => setMemoryDialogRole(role)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-xs text-muted-foreground hover:bg-muted transition-colors"
                    >
                      <Brain className="w-3 h-3" />
                      View Memory
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* User */}
      <div className="p-4 border-t border-border">
        {sidebarOpen && (
          <>
            {environment && (
              <div className="mb-4">
                <span className={`px-2 py-1 rounded text-xs font-medium ${getEnvironmentBadgeClass(environment.env)}`}>
                  {environment.env.toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 pb-2">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <span className="text-sm font-medium">
                  {user?.name?.[0] || user?.email?.[0] || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {user?.name || 'User'}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {user?.email}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="border-t border-border my-2" />

        <div className="flex flex-col gap-1">
          <button
            onClick={() => setShowScheduledJobs(true)}
            className="p-2 hover:bg-muted rounded-lg flex items-center gap-2 text-sm"
            title="Scheduled Jobs"
          >
            <Clock className="w-4 h-4" />
            {sidebarOpen && <span>Scheduled</span>}
          </button>
          <button
            onClick={() => setShowMcpManager(true)}
            className="p-2 hover:bg-muted rounded-lg flex items-center gap-2 text-sm"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
            {sidebarOpen && <span>Settings</span>}
          </button>
          <button
            onClick={logout}
            className="p-2 hover:bg-muted rounded-lg flex items-center gap-2 text-sm text-destructive"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </div>

      {/* Create Role Dialog */}
      <CreateRoleDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreateRole={handleCreateRole}
      />
      <MemoryOverviewDialog
        role={memoryDialogRole}
        onClose={() => setMemoryDialogRole(null)}
      />
      <ScheduledJobsDialog
        open={showScheduledJobs}
        onClose={() => setShowScheduledJobs(false)}
      />
    </div>
    </>
  );
}