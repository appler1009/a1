/**
 * In-Process MCP Modules
 * 
 * This directory contains in-process implementations of MCP servers.
 * These modules can be used directly without spawning a separate process,
 * providing lower latency and better debugging capabilities.
 */

export { GoogleDriveInProcess } from './google-drive.js';
export { SQLiteMemoryInProcess } from './sqlite-memory.js';
