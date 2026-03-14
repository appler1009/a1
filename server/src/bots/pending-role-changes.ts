/**
 * Pending role changes from bot interactions (Discord, Telegram, etc.)
 * Shared state between the role-manager MCP and all bot integrations.
 *
 * Format: appUserId -> { roleId, roleName }
 * Used to apply role changes after the chat stream completes
 */
export const pendingRoleChanges = new Map<string, { roleId: string; roleName: string }>();
