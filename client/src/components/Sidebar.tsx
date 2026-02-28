import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Settings,
  LogOut,
  Plus,
  ChevronDown,
  ChevronRight,
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
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 611.998 611.998" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M424.546,104.617l23.071,32.499l38.456,54.169l-1.851,8.856c-0.347,1.626-3.67,16.542-15.224,38.881c-17.544,33.913-53.591,84.072-125.671,130.44c-13.701,9.049-137.734,88.911-208.921,65.923l-8.252-2.667l-20.366-40.571h-0.006L74.884,330.6l-2.905-5.79C38.677,359.134-32.388,446.227,16.853,522.773c0,0,75.345,127.393,293.925-13.232c0,0,349.476-230.225,295.57-390.496C606.353,119.051,579.702,41.669,424.546,104.617z"/>
                      <path d="M280.2,262.402c90.833-58.424,121.545-119.347,130.285-141.808l-5.43-7.641l-46.496-65.48C311.105,4.479,171.34,99.791,171.34,99.791C25.618,193.541,56.26,247.331,56.26,247.331l31.349,62.44l10.212,20.334C147.189,340.555,245.869,285.03,280.2,262.402zM127.447,225.327c-2.371-5.199-0.084-11.349,5.122-13.721c37.698-17.204,83.372-46.869,83.834-47.164c40.526-26.072,66.11-48.643,80.441-62.993c4.042-4.049,10.597-4.049,14.646-0.013c3.278,3.271,3.901,8.187,1.883,12.088c-0.476,0.919-1.105,1.787-1.877,2.558c-21.889,21.921-50.101,44.041-83.841,65.744c-1.87,1.215-47.357,30.764-86.488,48.623C135.969,232.827,129.825,230.532,127.447,225.327z"/>
                      <path d="M130.66,395.528l10.109,20.141c63.777,20.597,191.35-63.636,191.35-63.636c114.54-73.687,131.821-156.146,131.821-156.146l-12.538-17.667c-1.208,2.622-2.571,5.43-4.152,8.464c-16.388,31.676-53.353,84.997-131.879,135.517C310.437,325.459,201.564,396.582,130.66,395.528z"/>
                    </svg>
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