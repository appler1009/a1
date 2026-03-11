import type { MCPServerConfig, McpAdapter } from '@local-agent/shared';
import { BaseStdioAdapter } from './BaseStdioAdapter.js';
import { InProcessAdapter, type InProcessMCPModule } from './InProcessAdapter.js';
import { SQLiteMemoryInProcess } from '../in-process/sqlite-memory.js';
import { DynamoDBMemoryInProcess } from '../in-process/dynamodb-memory.js';
import { WeatherInProcess } from '../in-process/weather.js';
import { MetaMcpSearchInProcess } from '../in-process/meta-mcp-search.js';
import { GoogleDriveInProcess } from '../in-process/google-drive.js';
import { GmailInProcess } from '../in-process/gmail.js';
import { GoogleCalendarInProcess } from '../in-process/google-calendar.js';
import { DisplayEmailInProcess } from '../in-process/display-email.js';
import { ProcessEachInProcess } from '../in-process/process-each.js';
import { RoleManagerInProcess } from '../in-process/role-manager.js';
import { AlphaVantageInProcess } from '../in-process/alpha-vantage.js';
import { TwelveDataInProcess } from '../in-process/twelve-data.js';
import { SchedulerInProcess } from '../in-process/scheduler.js';
import { FetchUrlInProcess } from '../in-process/fetch-url.js';
import { SmtpImapInProcess, type SmtpImapCredentials } from '../in-process/smtp-imap.js';
import { getMainDatabaseSync } from '../../storage/index.js';

/**
 * Token data shapes passed to adapter factories.
 * Using a union rather than `any` so factory implementations can narrow safely.
 */
export interface GoogleTokenData {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type: string;
}

export interface RoleScopedTokenData {
  roleId: string;
  dbPath?: string;
}

export interface ApiKeyTokenData {
  apiKey: string;
}

export type AdapterTokenData = GoogleTokenData | RoleScopedTokenData | ApiKeyTokenData | SmtpImapCredentials;

/**
 * Simple concrete implementation of BaseStdioAdapter for generic MCP servers
 */
class StdioAdapter extends BaseStdioAdapter {
  // No special token handling - just use base behavior
}

/**
 * Factory function type for creating in-process modules
 */
export type InProcessModuleFactory = (userId: string, tokenData?: AdapterTokenData) => InProcessMCPModule | Promise<InProcessMCPModule>;

interface InProcessRegistryEntry {
  type: 'in-process';
  factory: InProcessModuleFactory;
}

interface StdioRegistryEntry {
  type: 'stdio';
  adapterClass: typeof StdioAdapter;
}

type RegistryEntry = InProcessRegistryEntry | StdioRegistryEntry;

/**
 * Registry for MCP adapters.
 * Maps a primary server key to an adapter class or in-process factory.
 * Alternate display names (e.g. "Google Drive" vs "google-drive-mcp-lib") are
 * registered as aliases that resolve to the same primary entry.
 */
class AdapterRegistry {
  private entries = new Map<string, RegistryEntry>();
  private aliases = new Map<string, string>(); // alias key -> primary key

  private resolve(key: string): string {
    return this.aliases.get(key) ?? key;
  }

  constructor() {
    const useDynamoDBMemory = process.env.STORAGE_TYPE === 's3';
    const tablePrefix = process.env.DYNAMODB_TABLE_PREFIX ?? '';

    this.registerInProcess('google-drive-mcp-lib', (_userId, tokenData) => {
      if (!tokenData) throw new Error('Token data required for Google Drive in-process adapter');
      return new GoogleDriveInProcess(tokenData as GoogleTokenData);
    }, ['Google Drive']);

    this.registerStdio('markitdown', StdioAdapter, ['MarkItDown']);

    this.registerInProcess('memory', (userId, tokenData) => {
      const roleData = tokenData as RoleScopedTokenData | undefined;
      const roleId = roleData?.roleId;
      if (useDynamoDBMemory && roleId) {
        return new DynamoDBMemoryInProcess(roleId, { tablePrefix });
      }
      const dbPath = roleData?.dbPath || `data/memory-${userId}.db`;
      return new SQLiteMemoryInProcess(dbPath);
    }, ['Memory']);

    this.registerInProcess('weather', () => new WeatherInProcess(), ['Weather']);

    this.registerInProcess('meta-mcp-search', (userId) => new MetaMcpSearchInProcess(userId), ['Meta MCP Search']);

    this.registerInProcess('gmail-mcp-lib', (_userId, tokenData) => {
      if (!tokenData) throw new Error('Token data required for Gmail in-process adapter');
      const storageRoot = process.env.STORAGE_ROOT || './data';
      return new GmailInProcess(tokenData as GoogleTokenData, storageRoot);
    }, ['Gmail']);

    this.registerInProcess('google-calendar-mcp-lib', (_userId, tokenData) => {
      if (!tokenData) throw new Error('Token data required for Google Calendar in-process adapter');
      return new GoogleCalendarInProcess(tokenData as GoogleTokenData);
    }, ['Google Calendar']);

    this.registerInProcess('display-email', () => new DisplayEmailInProcess(), ['Display Email']);

    this.registerInProcess('process-each', () => new ProcessEachInProcess(), ['Process Each']);

    this.registerInProcess('role-manager', (userId) => {
      const mainDb = getMainDatabaseSync();
      return new RoleManagerInProcess(userId, mainDb);
    }, ['Role Manager']);

    this.registerInProcess('alpha-vantage', (_userId, tokenData) => {
      const apiKey = (tokenData as ApiKeyTokenData | undefined)?.apiKey;
      if (!apiKey) throw new Error('Alpha Vantage API key not configured');
      return new AlphaVantageInProcess(apiKey);
    }, ['Alpha Vantage']);

    this.registerInProcess('twelve-data', (_userId, tokenData) => {
      const apiKey = (tokenData as ApiKeyTokenData | undefined)?.apiKey;
      if (!apiKey) throw new Error('Twelve Data API key not configured');
      return new TwelveDataInProcess(apiKey);
    }, ['Twelve Data']);

    this.registerInProcess('scheduler', (userId, tokenData) => {
      const mainDb = getMainDatabaseSync();
      return new SchedulerInProcess(mainDb, userId, (tokenData as RoleScopedTokenData | undefined)?.roleId || '');
    });

    this.registerInProcess('fetch-url', () => new FetchUrlInProcess(), ['Fetch URL']);

    this.registerInProcess('smtp-imap-mcp-lib', (_userId, tokenData) => {
      if (!tokenData) throw new Error('SMTP/IMAP credentials not configured. Please connect in Settings.');
      return new SmtpImapInProcess(tokenData as SmtpImapCredentials);
    }, ['SMTP / IMAP Email']);
  }

  registerStdio(
    primaryKey: string,
    adapterClass: typeof StdioAdapter,
    aliases: string[] = []
  ): void {
    this.entries.set(primaryKey, { type: 'stdio', adapterClass });
    for (const alias of aliases) this.aliases.set(alias, primaryKey);
  }

  registerInProcess(
    primaryKey: string,
    factory: InProcessModuleFactory,
    aliases: string[] = []
  ): void {
    this.entries.set(primaryKey, { type: 'in-process', factory });
    for (const alias of aliases) this.aliases.set(alias, primaryKey);
  }

  isInProcess(serverKey: string): boolean {
    const entry = this.entries.get(this.resolve(serverKey));
    return entry?.type === 'in-process';
  }

  async createRawModule(
    serverKey: string,
    userId: string,
    tokenData?: AdapterTokenData
  ): Promise<InProcessMCPModule> {
    const entry = this.entries.get(this.resolve(serverKey));

    if (!entry || entry.type !== 'in-process') {
      throw new Error(`No in-process adapter registered for ${serverKey}`);
    }

    return entry.factory(userId, tokenData);
  }

  async createInProcess(
    serverKey: string,
    userId: string,
    id: string,
    tokenData?: AdapterTokenData
  ): Promise<InProcessAdapter> {
    const entry = this.entries.get(this.resolve(serverKey));

    if (!entry || entry.type !== 'in-process') {
      throw new Error(`No in-process adapter registered for ${serverKey}`);
    }

    const module = await entry.factory(userId, tokenData);
    return new InProcessAdapter(id, userId, serverKey, module);
  }

  create(
    serverKey: string,
    userId: string,
    id: string,
    config: MCPServerConfig,
    cwd: string,
    tokenData?: AdapterTokenData
  ): BaseStdioAdapter {
    const entry = this.entries.get(this.resolve(serverKey));

    if (!entry || entry.type === 'in-process') {
      return new StdioAdapter(
        id,
        userId,
        serverKey,
        config.command || '',
        config.args || [],
        cwd,
        config.env || {}
      );
    }

    const AdapterClass = entry.adapterClass;
    return new AdapterClass(
      id,
      userId,
      serverKey,
      config.command || '',
      config.args || [],
      cwd,
      config.env || {}
    );
  }
}

export const adapterRegistry = new AdapterRegistry();
