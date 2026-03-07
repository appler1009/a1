/**
 * In-Process MCP Modules
 *
 * This directory contains in-process implementations of MCP servers.
 * These modules can be used directly without spawning a separate process,
 * providing lower latency and better debugging capabilities.
 */

export { GoogleDriveInProcess } from './google-drive.js';
export { SQLiteMemoryInProcess } from './sqlite-memory.js';
export { MetaMcpSearchInProcess, updateToolManifest, searchTools, isSearchEngineReady } from './meta-mcp-search.js';
export { DisplayEmailInProcess, getDisplayEmailToolDefinition, isDisplayEmailMarker, extractEmailDataFromMarker, initializeDisplayEmail } from './display-email.js';
export { GmailInProcess, initializeGmailInProcess, isGmailCacheId, isGmailThreadCacheId, getGmailMessageIdFromCacheId, getGmailThreadIdFromCacheId, parseGmailMessage, fetchAndCacheGmailMessage } from './gmail.js';
export { GoogleCalendarInProcess } from './google-calendar.js';
export { RoleManagerInProcess } from './role-manager.js';
export { AlphaVantageInProcess } from './alpha-vantage.js';
export { TwelveDataInProcess } from './twelve-data.js';
export { FetchUrlInProcess } from './fetch-url.js';
