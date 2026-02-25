/**
 * Pending role changes from Discord bot interaction
 * Shared state between the role-manager MCP and Discord bot
 *
 * Format: userId -> { roleId, roleName }
 * Used to apply role changes after the chat stream completes
 */
export const pendingRoleChanges = new Map<string, { roleId: string; roleName: string }>();
