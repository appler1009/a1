/**
 * Shared mutable singletons used across route files and the main index.
 * Centralised here to avoid circular imports between index.ts and route files.
 */

import type { ServerResponse } from 'http';
import type { TempStorage } from './storage/temp-storage.js';
import type { createLLMRouter } from './ai/router.js';
import type { JobRunner } from './scheduler/job-runner.js';

// ---------------------------------------------------------------------------
// State variables
// ---------------------------------------------------------------------------

export let tempStorage: TempStorage;
export let llmRouter: ReturnType<typeof createLLMRouter>;
export let jobRunner: JobRunner | null = null;

/** Server-side tracking of the currently active role (last set via header or switch). */
export let serverCurrentRoleId: string | null = null;

/** Active SSE chat streams — closed on SIGTERM so ALB draining is unblocked. */
export const activeStreams = new Set<ServerResponse>();

/**
 * Per-role SSE subscribers for cross-device message sync.
 * Keyed by "userId#roleId".
 */
export const messageSubscribers = new Map<string, Set<ServerResponse>>();

// ---------------------------------------------------------------------------
// Setters
// ---------------------------------------------------------------------------

export function setTempStorage(ts: TempStorage): void {
  tempStorage = ts;
}

export function setLlmRouter(router: ReturnType<typeof createLLMRouter>): void {
  llmRouter = router;
}

export function setJobRunner(runner: JobRunner | null): void {
  jobRunner = runner;
}

export function setServerCurrentRoleId(roleId: string | null): void {
  serverCurrentRoleId = roleId;
}
