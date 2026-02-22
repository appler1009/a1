/**
 * Google Drive In-Process MCP Module
 *
 * Uses google-drive-mcp-lib for direct in-process Google Drive API calls.
 * This provides lower latency compared to STDIO-based MCP servers.
 *
 * Tools provided (7 total):
 * - googleDriveListFiles - List files in Google Drive
 * - googleDriveUploadFile - Upload a file to Google Drive
 * - googleDriveGetFile - Get metadata for a file
 * - googleDriveDownloadFile - Download a file from Google Drive
 * - googleDriveCreateFolder - Create a new folder
 * - googleDriveSearchFiles - Search for files
 * - googleDriveDeleteFile - Delete a file
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  listFiles,
  uploadFile,
  getFile,
  downloadFile,
  createFolder,
  searchFiles,
  deleteFile,
  toolDefinitions,
  type Tokens,
  type ListFilesOperationOptions,
  type UploadFileOperationOptions,
  type GetFileOperationOptions,
  type DownloadFileOperationOptions,
  type CreateFolderOperationOptions,
  type SearchFilesOperationOptions,
  type DeleteFileOperationOptions,
} from 'google-drive-mcp-lib';

/**
 * Token data passed from the adapter factory
 */
interface GoogleTokenData {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
}

/**
 * Google Drive In-Process MCP Module
 *
 * Provides tools for Google Drive operations using the google-drive-mcp-lib package.
 */
export class GoogleDriveInProcess implements InProcessMCPModule {
  private tokens: Tokens;

  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor(tokenData: GoogleTokenData) {
    this.tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: tokenData.expiry_date,
      token_type: tokenData.token_type || 'Bearer',
    };
    console.log('[GoogleDriveInProcess] Initialized with token data');
  }

  /**
   * Convert user-friendly query syntax to Google Drive API syntax
   * Handles:
   * - "filetype:pdf" style queries to proper Google Drive query format
   * - Double quotes to single quotes in mimeType filters
   * - Adding "and" operator between search queries and filters
   */
  private convertQuerySyntax(query: string): string {
    console.log(`[GoogleDriveInProcess:convertQuerySyntax] Input: "${query}"`);

    let convertedQuery = query;

    // Step 1: Convert double quotes to single quotes in mimeType values
    // Pattern: mimeType="something" → mimeType='something'
    convertedQuery = convertedQuery.replace(/mimeType="([^"]+)"/g, "mimeType='$1'");

    // Step 2: Convert filetype:pdf to mimeType='application/pdf'
    convertedQuery = convertedQuery.replace(/filetype:\s*pdf/gi, "mimeType='application/pdf'");
    convertedQuery = convertedQuery.replace(/filetype:\s*doc/gi, "mimeType='application/msword' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'");
    convertedQuery = convertedQuery.replace(/filetype:\s*sheet/gi, "mimeType='application/vnd.ms-excel' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'");
    convertedQuery = convertedQuery.replace(/filetype:\s*ppt/gi, "mimeType='application/vnd.ms-powerpoint' or mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation'");

    // Step 3: Add "and" operator between search text and mimeType filters
    // Pattern: ") mimeType=" → ") and mimeType="
    convertedQuery = convertedQuery.replace(/\)\s+mimeType=/g, ") and mimeType=");

    // Also handle case where mimeType appears after regular text (no closing paren)
    // Pattern: "text" mimeType= → "text" and mimeType=
    convertedQuery = convertedQuery.replace(/"\s+mimeType=/g, "\" and mimeType=");

    // Step 4: Normalize whitespace around operators
    convertedQuery = convertedQuery.replace(/\s+and\s+/gi, ' and ');
    convertedQuery = convertedQuery.replace(/\s+or\s+/gi, ' or ');

    console.log(`[GoogleDriveInProcess:convertQuerySyntax] Output: "${convertedQuery}"`);
    return convertedQuery;
  }

  /**
   * List all available tools
   */
  async getTools(): Promise<MCPToolInfo[]> {
    // Convert tool definitions from the library to MCPToolInfo format
    return toolDefinitions.map((tool) => {
      // Use zod-to-json-schema library for robust conversion
      const jsonSchema = zodToJsonSchema(tool.schema, { target: 'jsonSchema7' });
      // Remove $schema property as MCP doesn't use it
      const { $schema, ...inputSchema } = jsonSchema as Record<string, unknown>;
      return {
        name: tool.name,
        description: tool.description,
        inputSchema,
      };
    });
  }

  /**
   * Tool: List files in Google Drive
   */
  async googleDriveListFiles(args: ListFilesOperationOptions): Promise<any> {
    console.log('[GoogleDriveInProcess:googleDriveListFiles] Listing files');
    try {
      const result = await listFiles({
        ...args,
        tokens: this.tokens,
      });
      return result;
    } catch (error) {
      console.error('[GoogleDriveInProcess:googleDriveListFiles] Error:', error);
      throw error;
    }
  }

  /**
   * Tool: Upload a file to Google Drive
   */
  async googleDriveUploadFile(args: UploadFileOperationOptions): Promise<any> {
    console.log('[GoogleDriveInProcess:googleDriveUploadFile] Uploading file:', args.name);
    try {
      const result = await uploadFile({
        ...args,
        tokens: this.tokens,
      });
      return result;
    } catch (error) {
      console.error('[GoogleDriveInProcess:googleDriveUploadFile] Error:', error);
      throw error;
    }
  }

  /**
   * Tool: Get file metadata
   */
  async googleDriveGetFile(args: GetFileOperationOptions): Promise<any> {
    console.log('[GoogleDriveInProcess:googleDriveGetFile] Getting file:', args.fileId);
    try {
      const result = await getFile({
        ...args,
        tokens: this.tokens,
      });
      return result;
    } catch (error) {
      console.error('[GoogleDriveInProcess:googleDriveGetFile] Error:', error);
      throw error;
    }
  }

  /**
   * Tool: Download a file from Google Drive
   */
  async googleDriveDownloadFile(args: DownloadFileOperationOptions): Promise<any> {
    console.log('[GoogleDriveInProcess:googleDriveDownloadFile] Downloading file:', args.fileId);
    try {
      const result = await downloadFile({
        ...args,
        tokens: this.tokens,
      });
      // Return content as base64 for binary data
      return {
        id: result.id,
        name: result.name,
        mimeType: result.mimeType,
        content: result.content.toString('base64'),
        size: result.size,
        encoding: 'base64',
      };
    } catch (error) {
      console.error('[GoogleDriveInProcess:googleDriveDownloadFile] Error:', error);
      throw error;
    }
  }

  /**
   * Tool: Create a new folder
   */
  async googleDriveCreateFolder(args: CreateFolderOperationOptions): Promise<any> {
    console.log('[GoogleDriveInProcess:googleDriveCreateFolder] Creating folder:', args.name);
    try {
      const result = await createFolder({
        ...args,
        tokens: this.tokens,
      });
      return result;
    } catch (error) {
      console.error('[GoogleDriveInProcess:googleDriveCreateFolder] Error:', error);
      throw error;
    }
  }

  /**
   * Tool: Search for files
   */
  async googleDriveSearchFiles(args: SearchFilesOperationOptions): Promise<any> {
    console.log('[GoogleDriveInProcess:googleDriveSearchFiles] Original query:', args.query);

    // Convert user-friendly syntax to Google Drive API syntax
    const convertedQuery = this.convertQuerySyntax(args.query);

    try {
      const result = await searchFiles({
        ...args,
        query: convertedQuery,
        tokens: this.tokens,
      });
      return result;
    } catch (error) {
      console.error('[GoogleDriveInProcess:googleDriveSearchFiles] Error:', error);
      throw error;
    }
  }

  /**
   * Tool: Delete a file
   */
  async googleDriveDeleteFile(args: DeleteFileOperationOptions): Promise<any> {
    console.log('[GoogleDriveInProcess:googleDriveDeleteFile] Deleting file:', args.fileId);
    try {
      await deleteFile({
        ...args,
        tokens: this.tokens,
      });
      return { success: true, message: `File ${args.fileId} deleted` };
    } catch (error) {
      console.error('[GoogleDriveInProcess:googleDriveDeleteFile] Error:', error);
      throw error;
    }
  }
}
