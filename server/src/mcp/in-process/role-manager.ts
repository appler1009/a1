/**
 * Role Manager In-Process MCP Module
 *
 * Provides tools for managing roles within a conversation context.
 * Allows the LLM to switch between user's roles dynamically.
 *
 * Tools provided:
 * - list_roles - List all roles for the user
 * - switch_role - Switch to a different role
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import type { IMainDatabase } from '../../storage/main-db.js';
import { pendingRoleChanges } from '../../discord/pending-role-changes.js';

/**
 * Role Manager In-Process MCP Module
 */
export class RoleManagerInProcess implements InProcessMCPModule {
  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor(private userId: string, private mainDb: IMainDatabase) {
    console.log(`[RoleManagerInProcess] Initialized for user: ${userId}`);
  }

  /**
   * Get available tools for role management
   */
  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'list_roles',
        description: 'List all available roles for the current user',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'switch_role',
        description: 'Switch to a different role. Provide either roleName or roleId.',
        inputSchema: {
          type: 'object',
          properties: {
            roleName: {
              type: 'string',
              description: 'The name of the role to switch to (e.g., "Customer Support", "Sales")',
            },
            roleId: {
              type: 'string',
              description: 'The ID of the role to switch to',
            },
          },
          required: [],
        },
      },
    ];
  }

  /**
   * List all roles for the current user
   */
  async list_roles(args: any): Promise<unknown> {
    try {
      console.log('[RoleManagerInProcess:list_roles] Listing roles for user:', this.userId);
      const roles = await this.mainDb.getUserRoles(this.userId);

      if (roles.length === 0) {
        return {
          type: 'text',
          text: 'No roles found for this user.',
        };
      }

      const rolesText = roles
        .map((role) => `- ${role.name} (ID: ${role.id})${role.jobDesc ? `: ${role.jobDesc}` : ''}`)
        .join('\n');

      return {
        type: 'text',
        text: `Available roles:\n${rolesText}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[RoleManagerInProcess:list_roles] Error:', errorMsg);
      return {
        type: 'text',
        text: `Error listing roles: ${errorMsg}`,
      };
    }
  }

  /**
   * Switch to a different role
   */
  async switch_role(args: any): Promise<unknown> {
    try {
      const { roleName, roleId } = args as { roleName?: string; roleId?: string };

      if (!roleName && !roleId) {
        return {
          type: 'text',
          text: 'Error: Please provide either roleName or roleId',
        };
      }

      console.log(
        `[RoleManagerInProcess:switch_role] Attempting to switch to role. Name: ${roleName}, ID: ${roleId}`
      );

      // Get the role
      let targetRole = null;

      if (roleId) {
        targetRole = await this.mainDb.getRole(roleId);
      } else if (roleName) {
        // Find role by name
        const roles = await this.mainDb.getUserRoles(this.userId);
        targetRole = roles.find((r) => r.name.toLowerCase() === roleName.toLowerCase()) || null;
      }

      if (!targetRole) {
        return {
          type: 'text',
          text: `Error: Role not found. Please use list_roles to see available roles.`,
        };
      }

      // Verify the user owns this role
      if (targetRole.userId !== this.userId) {
        return {
          type: 'text',
          text: 'Error: You do not have access to this role',
        };
      }

      // Store pending role change for the Discord bot (or other clients) to apply after the stream ends
      pendingRoleChanges.set(this.userId, {
        roleId: targetRole.id,
        roleName: targetRole.name,
      });

      console.log(`[RoleManagerInProcess:switch_role] Role switch scheduled: ${targetRole.name} (${targetRole.id})`);

      // Return role info so web UI can update immediately
      return {
        type: 'text',
        text: `Successfully switched to role: ${targetRole.name}. The active role will be updated for your next message.`,
        // Include role metadata for client-side UI updates
        metadata: {
          roleSwitch: {
            roleId: targetRole.id,
            roleName: targetRole.name,
            systemPrompt: targetRole.systemPrompt,
            jobDesc: targetRole.jobDesc,
          },
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[RoleManagerInProcess:switch_role] Error:', errorMsg);
      return {
        type: 'text',
        text: `Error switching role: ${errorMsg}`,
      };
    }
  }
}
