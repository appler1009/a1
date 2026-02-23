/**
 * Meta MCP Search In-Process Adapter
 * 
 * Provides semantic search over all available MCP tools.
 * This is the initial tool exposed to the LLM for tool discovery.
 * 
 * Flow:
 * 1. LLM starts with only search_tool available
 * 2. LLM calls search_tool with natural language query
 * 3. search_tool returns relevant tools with their server info
 * 4. System dynamically loads those tools for the LLM to use
 */

import type { MCPToolInfo } from '@local-agent/shared';
import { MetaMcpSearch, type ToolDef } from 'meta-mcp-search';

/**
 * Result from searchWithScores
 * Extended ToolDef to include requiresDetailedSchema flag
 */
interface ExtendedToolDef extends ToolDef {
  requiresDetailedSchema?: boolean;
}

interface ScoredTool {
  tool: ExtendedToolDef;
  score: number;
}

/**
 * Global instance of the search engine
 */
let searchInstance: MetaMcpSearch | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

/**
 * Tool manifest for meta-mcp-search
 * This is built dynamically from all available MCP tools
 */
let toolManifest: ToolDef[] = [];

/**
 * Initialize the search engine with tools
 */
async function initSearchEngine(): Promise<void> {
  if (searchInstance) return;
  if (isInitializing && initPromise) {
    await initPromise;
    return;
  }

  isInitializing = true;
  initPromise = (async () => {
    try {
      console.log('[MetaMcpSearch] Initializing search engine...');
      
      searchInstance = new MetaMcpSearch({
        tools: toolManifest
      });
      
      await searchInstance.init();
      
      console.log(`[MetaMcpSearch] Search engine initialized with ${toolManifest.length} tools`);
    } catch (error) {
      console.error('[MetaMcpSearch] Failed to initialize search engine:', error);
      searchInstance = null;
      throw error;
    } finally {
      isInitializing = false;
    }
  })();

  await initPromise;
}

/**
 * Update the tool manifest and reinitialize the search engine
 * This is called when tools are discovered from MCP servers
 */
export async function updateToolManifest(tools: Array<{
  serverId: string;
  tools: MCPToolInfo[]
}>): Promise<void> {
  console.log(`[MetaMcpSearch] Updating tool manifest with ${tools.reduce((sum, s) => sum + s.tools.length, 0)} tools from ${tools.length} servers`);

  // Convert to ToolDef format, preserving requiresDetailedSchema flag
  toolManifest = tools.flatMap(({ serverId, tools: serverTools }) =>
    serverTools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema as ToolDef['inputSchema'],
      serverKey: serverId,
      requiresDetailedSchema: tool.requiresDetailedSchema
    }))
  ) as any; // Cast to any since ToolDef doesn't have requiresDetailedSchema but we add it dynamically

  // Reinitialize search engine with new tools
  if (searchInstance) {
    searchInstance = null;
  }

  if (toolManifest.length > 0) {
    await initSearchEngine();
  }
}

/**
 * Search for tools matching a natural language query
 */
export async function searchTools(query: string, limit: number = 5): Promise<ScoredTool[]> {
  console.log(`[MetaMcpSearch] Searching for: "${query}" (limit: ${limit})`);
  
  if (!searchInstance) {
    await initSearchEngine();
  }

  if (!searchInstance) {
    console.log('[MetaMcpSearch] No search instance available');
    return [];
  }

  try {
    const results = await searchInstance.searchWithScores(query, limit);
    // Ensure we respect the limit (the library might return more)
    const limitedResults = results.slice(0, limit);
    console.log(`[MetaMcpSearch] Found ${limitedResults.length} matching tools (requested: ${limit})`);
    return limitedResults;
  } catch (error) {
    console.error('[MetaMcpSearch] Search failed:', error);
    return [];
  }
}

/**
 * Get the current tool manifest
 */
export function getToolManifest(): ToolDef[] {
  return toolManifest;
}

/**
 * Check if the search engine is initialized
 */
export function isSearchEngineReady(): boolean {
  return searchInstance !== null;
}

/**
 * In-process adapter class for MetaMcpSearch
 * Implements the same interface as other in-process adapters
 */
export class MetaMcpSearchInProcess {
  private userId: string;

  // Index signature for InProcessToolModule compatibility
  [toolName: string]: unknown;

  constructor(userId: string = 'system') {
    this.userId = userId;
    console.log(`[MetaMcpSearchInProcess] Created adapter for user: ${userId}`);
  }

  /**
   * Get available tools (just search_tool)
   */
  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'search_tool',
        description: `Search for MCP tools using natural language. Use this tool to discover what tools are available for your task.

IMPORTANT: This is your starting point for tool discovery. Describe what you want to accomplish in plain English, and this tool will return the most relevant MCP tools that can help you.

Examples:
- "list files in google drive" → returns google_drive_list tool
- "send a message to slack" → returns slack_send_message tool  
- "create a github issue" → returns github_create_issue tool
- "read a pdf document" → returns convert_to_markdown tool

After calling this tool, you'll receive tool names and their server information. The system will then make those tools available for you to use.`,
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language query describing what you want to accomplish'
            },
            limit: {
              type: 'number',
              default: 5,
              description: 'Maximum number of results to return (default: 5)'
            }
          },
          required: ['query']
        }
      }
    ];
  }

  /**
   * Call the search_tool
   */
  async search_tool(args: { query: string; limit?: number }): Promise<{
    type: 'text';
    text: string;
  }> {
    const { query, limit = 5 } = args;
    
    console.log(`[MetaMcpSearchInProcess] search_tool called: "${query}"`);
    
    try {
      const rawResults = await searchTools(query, limit + 1); // Fetch one extra to account for potential self-filtering
      
      // Filter out search_tool itself from results
      const results = rawResults.filter(({ tool }) => tool.name !== 'search_tool').slice(0, limit);
      
      if (results.length === 0) {
        return {
          type: 'text',
          text: 'No matching tools found. Try a different search query or check if the required MCP server is connected.'
        };
      }

      // Format results with full parameter schema for the LLM
      const formattedResults = results.map(({ tool, score }, index) => {
        let paramInfo = '';

        // For tools that require detailed schema, include the full schema
        if (tool.requiresDetailedSchema && tool.inputSchema) {
          paramInfo = `\n   Full Schema:\n\`\`\`json\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\``;
        } else if (tool.inputSchema?.properties) {
          // Otherwise, show a brief summary of parameters
          const props = tool.inputSchema.properties as Record<string, any>;
          const required = tool.inputSchema.required || [];

          const paramLines = Object.entries(props).map(([name, schema]: [string, any]) => {
            const isRequired = required.includes(name);
            const type = schema.type || 'unknown';
            const desc = schema.description || '';
            const defaultVal = schema.default !== undefined ? ` (default: ${schema.default})` : '';
            const reqLabel = isRequired ? '[REQUIRED]' : '[optional]';
            return `   - ${name} (${type})${defaultVal} ${reqLabel}: ${desc}`;
          }).join('\n');

          paramInfo = paramLines ? `\n   Parameters:\n${paramLines}` : '';
        } else {
          paramInfo = '\n   Parameters: none';
        }

        return `${index + 1}. **${tool.name}** (${tool.serverKey || 'unknown'}) - ${(score * 100).toFixed(0)}% match\n   ${tool.description?.substring(0, 150) || 'No description'}${paramInfo}`;
      }).join('\n\n');

      const response = `Found ${results.length} tools for "${query}":\n\n${formattedResults}`;

      return {
        type: 'text',
        text: response
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[MetaMcpSearchInProcess] search_tool error:`, error);
      return {
        type: 'text',
        text: `Error searching for tools: ${errorMsg}`
      };
    }
  }

  /**
   * List resources (none for this adapter)
   */
  async getResources(): Promise<[]> {
    return [];
  }
}

export default MetaMcpSearchInProcess;
