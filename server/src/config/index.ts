import { v4 as uuidv4 } from 'uuid';

export interface AppConfig {
  env: { nodeEnv: string; isDevelopment: boolean; isTest: boolean; isProduction: boolean };
  port: number;
  host: string;
  logLevel: string;
  frontendUrl: string;
  database: { type: 'sqlite'; path: string };
  storage: { type: 'fs' | 'sqlite' | 's3'; root: string; bucket?: string; endpoint?: string; region?: string };
  auth: { secret: string; sessionTTL: number };
  llm: {
    provider: 'grok' | 'openai' | 'anthropic';
    grokApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    defaultModel?: string;
    routerEnabled: boolean;
  };
  google: { clientId: string; clientSecret: string; redirectUri: string };
  gmail: { clientId: string; clientSecret: string; redirectUri: string };
  github: { clientId: string; clientSecret: string; redirectUri: string };
  discord: { botToken?: string; clientId?: string; channelIds: string[] };
}

// Mutable singleton — populated by initConfig() before any request handlers run
export let config: AppConfig;

export function initConfig(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  config = {
    env: {
      nodeEnv,
      isDevelopment: nodeEnv === 'development',
      isTest: nodeEnv === 'test',
      isProduction: nodeEnv === 'production',
    },
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    logLevel: process.env.LOG_LEVEL || 'info',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    database: { type: 'sqlite', path: process.env.DATABASE_PATH || './data/metadata.db' },
    storage: {
      type: (process.env.STORAGE_TYPE as 'fs' | 'sqlite' | 's3') || 'fs',
      root: process.env.STORAGE_ROOT || './data',
      bucket: process.env.STORAGE_BUCKET || undefined,
      endpoint: process.env.STORAGE_ENDPOINT || undefined,
      region: process.env.STORAGE_REGION || undefined,
    },
    auth: { secret: process.env.AUTH_SECRET || uuidv4(), sessionTTL: 30 * 24 * 60 * 60 * 1000 },
    llm: {
      provider: (process.env.LLM_PROVIDER as 'grok' | 'openai' | 'anthropic') || 'grok',
      grokApiKey: process.env.GROK_API_KEY || '',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
      defaultModel: process.env.DEFAULT_MODEL,
      routerEnabled: process.env.ROUTER_ENABLED === 'true',
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
    },
    gmail: {
      clientId: process.env.GMAIL_CLIENT_ID || '',
      clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
      redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/gmail/callback',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      redirectUri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/auth/github/callback',
    },
    discord: {
      botToken: process.env.DISCORD_BOT_TOKEN,
      clientId: process.env.DISCORD_CLIENT_ID,
      channelIds: (process.env.DISCORD_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    },
  };
}
