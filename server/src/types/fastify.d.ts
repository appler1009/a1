import 'fastify';
import type { User, Session } from '@local-agent/shared';
import type { StorageService } from '../storage/index.js';
import type { LLMRouter } from '../ai/router.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    session: Session | null;
    context: AppContext;
  }
}

export interface AppContext {
  config: import('@local-agent/shared').AppConfig;
  storage: StorageService;
  llmRouter: LLMRouter;
}