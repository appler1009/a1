import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import type { MCPRequest, MCPResponse, MCPToolInfo, MCPResource, MCPServerInfo } from '@local-agent/shared';
import type { MCPServerConfig } from '@local-agent/shared';

export interface MCPClientInterface {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<MCPToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  listResources(): Promise<MCPResource[]>;
  readResource(uri: string): Promise<unknown>;
  getInfo(): MCPServerInfo | null;
}

/**
 * MCP Client for stdio transport
 */
export class MCPStdioClient implements MCPClientInterface {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: MCPResponse) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private serverInfo: MCPServerInfo | null = null;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.command) {
      throw new Error('Command is required for stdio transport');
    }

    this.process = spawn(this.config.command, [], {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`MCP stderr: ${data.toString()}`);
    });

    this.process.on('close', () => {
      this.process = null;
    });

    // Initialize connection
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'local-agent-ui',
        version: '1.0.0',
      },
    });

    this.serverInfo = initResponse.result as MCPServerInfo;
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private handleData(data: string): void {
    this.buffer += data;
    
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line) as MCPResponse;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
          }
        } catch (error) {
          console.error('Failed to parse MCP response:', error);
        }
      }
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      
      this.process.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async listTools(): Promise<MCPToolInfo[]> {
    const response = await this.sendRequest('tools/list');
    return (response.result as { tools: MCPToolInfo[] }).tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
    return response.result;
  }

  async listResources(): Promise<MCPResource[]> {
    const response = await this.sendRequest('resources/list');
    return (response.result as { resources: MCPResource[] }).resources;
  }

  async readResource(uri: string): Promise<unknown> {
    const response = await this.sendRequest('resources/read', { uri });
    return response.result;
  }

  getInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }
}

/**
 * MCP Client for WebSocket transport
 */
export class MCPWebSocketClient implements MCPClientInterface {
  private config: MCPServerConfig;
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: MCPResponse) => void;
    reject: (error: Error) => void;
  }>();
  private serverInfo: MCPServerInfo | null = null;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.url) {
      throw new Error('URL is required for websocket transport');
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.url!);

      this.ws.on('open', async () => {
        try {
          const initResponse = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'local-agent-ui',
              version: '1.0.0',
            },
          });
          this.serverInfo = initResponse.result as MCPServerInfo;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const response = JSON.parse(data.toString()) as MCPResponse;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
          }
        } catch (error) {
          console.error('Failed to parse MCP response:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('Not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: MCPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async listTools(): Promise<MCPToolInfo[]> {
    const response = await this.sendRequest('tools/list');
    return (response.result as { tools: MCPToolInfo[] }).tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });
    return response.result;
  }

  async listResources(): Promise<MCPResource[]> {
    const response = await this.sendRequest('resources/list');
    return (response.result as { resources: MCPResource[] }).resources;
  }

  async readResource(uri: string): Promise<unknown> {
    const response = await this.sendRequest('resources/read', { uri });
    return response.result;
  }

  getInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }
}

/**
 * Create an MCP client based on transport type
 */
export function createMCPClient(config: MCPServerConfig): MCPClientInterface {
  switch (config.transport) {
    case 'stdio':
      return new MCPStdioClient(config);
    case 'websocket':
      return new MCPWebSocketClient(config);
    case 'http':
      // HTTP transport would be similar to WebSocket
      throw new Error('HTTP transport not yet implemented');
    default:
      throw new Error(`Unknown transport type: ${(config as { transport: string }).transport}`);
  }
}