import {
  MessageSquare,
  Settings,
  LogOut,
  Plus,
  ChevronDown,
  Users
} from 'lucide-react';
import { useAuthStore, useRolesStore, useUIStore } from '../store';

export function Sidebar() {
  const { user, currentGroup, groups, setCurrentGroup, logout } = useAuthStore();
  const { roles, currentRole, setCurrentRole, addRole } = useRolesStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();

  const handleCreateRole = async () => {
    if (!currentGroup) return;
    
    const name = prompt('Enter role name:');
    if (!name) return;

    try {
      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          groupId: currentGroup.id,
          name,
        }),
      });
      
      const data = await response.json();
      if (data.success) {
        addRole(data.data);
        setCurrentRole(data.data);
      }
    } catch (error) {
      console.error('Failed to create role:', error);
    }
  };

  return (
    <div className={`${sidebarOpen ? 'w-64' : 'w-16'} flex flex-col h-full bg-card border-r border-border transition-all duration-300`}>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-primary" />
              <span className="font-semibold">a1</span>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-muted rounded-lg"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${sidebarOpen ? '' : '-rotate-90'}`} />
          </button>
        </div>
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
              onClick={handleCreateRole}
              className="p-1 hover:bg-muted rounded-lg"
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
              <button
                key={role.id}
                onClick={() => setCurrentRole(role)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                  currentRole?.id === role.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <Users className="w-4 h-4" />
                {sidebarOpen && <span className="truncate">{role.name}</span>}
              </button>
            ))}
        </div>
      </div>

      {/* User */}
      <div className="p-4 border-t border-border">
        {sidebarOpen && (
          <div className="flex items-center gap-2 mb-2">
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
        )}

        <div className="flex items-center gap-2">
          <button
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
    </div>
  );
}