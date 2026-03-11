import path from 'path';
import type { FastifyInstance } from 'fastify';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';
import { authService } from '../auth/index.js';
import { GoogleOAuthHandler } from '../auth/google-oauth.js';
import { isGmailCacheId, getGmailMessageIdFromCacheId, fetchAndCacheGmailMessage } from '../mcp/in-process/gmail.js';
import { sanitizeFilename } from '../utils/text.js';
import { tempStorage } from '../shared-state.js';

export async function viewerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/viewer/files', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    // Placeholder - return empty list
    return reply.send({ success: true, data: [] });
  });

  fastify.get('/viewer/gmail', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    // Placeholder - return empty list
    return reply.send({ success: true, data: [] });
  });

  // Download file to temp directory for preview
  fastify.post('/viewer/download', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { url: string; filename?: string; mimeType?: string };

    console.log('\n[ViewerDownload] ========================================');
    console.log('[ViewerDownload] Download request received');
    console.log(`[ViewerDownload]   URL: ${body.url}`);
    console.log(`[ViewerDownload]   Filename: ${body.filename}`);
    console.log(`[ViewerDownload]   MIME Type: ${body.mimeType}`);

    if (!body.url) {
      console.log('[ViewerDownload] ERROR: URL is required');
      return reply.code(400).send({ success: false, error: { message: 'URL is required' } });
    }

    try {
      const fs = await import('fs/promises');

      // Create temp directory if it doesn't exist
      const tempDir = path.join(config.storage.root, 'temp');
      await fs.mkdir(tempDir, { recursive: true }).catch(() => {});

      // Check if body.url is a cache ID (not a real URL)
      // Cache IDs look like: gmail_xxx_yyyy, gmail_thread_xxx_yyyy, or file-id
      const isCacheId = !body.url.includes('://') && !body.url.includes('/');

      let cacheKey: string;
      let gdriveFileId: string | undefined;

      if (isCacheId) {
        // This is already a cache ID, use it directly
        console.log(`[ViewerDownload] Detected cache ID: ${body.url}`);
        cacheKey = body.url;
      } else {
        // Generate a cache key from the URL
        const crypto = await import('crypto');
        const urlHash = crypto.createHash('md5').update(body.url).digest('hex').substring(0, 12);

        // Check if this is a Google Drive URL to extract file ID for caching
        const gdriveMatch = body.url.match(/drive\.google\.com\/.*(?:file\/d\/|id=)([a-zA-Z0-9_-]+)/);
        const gdriveDownloadMatch = body.url.match(/drive\.google\.com\/uc\?export=download&id=([a-zA-Z0-9_-]+)/);
        gdriveFileId = gdriveMatch?.[1] || gdriveDownloadMatch?.[1];

        // Use Google Drive file ID as cache key if available, otherwise use URL hash
        cacheKey = gdriveFileId || urlHash;
      }

      // Look for existing cached file with this cache key using tempStorage
      const cachedFile = await tempStorage.findTempFileByCacheId(cacheKey);

      if (cachedFile) {
        // Get file stats based on storage type
        let fileSize: number;
        let cachedFilePath: string;

        if (tempStorage.getStorageType() === 's3') {
          // For S3, read the file to get size
          const fileBuffer = await tempStorage.readTempFile(cachedFile);
          if (!fileBuffer) {
            console.log(`[ViewerDownload] ERROR: File not found in S3: ${cachedFile}`);
            return reply.code(404).send({ success: false, error: { message: 'File not found in cache' } });
          }
          fileSize = fileBuffer.length;
          // For S3, we don't have a local path, we'll handle this below
          cachedFilePath = '';
        } else {
          // For local filesystem
          cachedFilePath = path.join(tempDir, cachedFile);
          const stats = await fs.stat(cachedFilePath);
          fileSize = stats.size;
        }
        console.log(`[ViewerDownload] Found cached file: ${cachedFile}`);
        console.log(`[ViewerDownload] Cache hit! Using cached file (${fileSize} bytes)`);

        // Determine content type from extension
        const ext = cachedFile.split('.').pop()?.toLowerCase() || '';
        const contentTypes: Record<string, string> = {
          pdf: 'application/pdf',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          html: 'text/html',
          txt: 'text/plain',
          json: 'application/json',
          md: 'text/markdown',
        };
        const contentType = contentTypes[ext] || body.mimeType || 'application/octet-stream';

        const previewUrl = `/api/viewer/temp/${cachedFile}`;

        // For local filesystem, provide the file path; for S3, we provide the preview URL
        let absoluteFilePath: string;
        let fileUri: string;

        if (tempStorage.getStorageType() === 's3') {
          // For S3, we don't have a local path - use the preview URL as the URI
          absoluteFilePath = previewUrl;
          fileUri = previewUrl;
        } else {
          // For local filesystem
          absoluteFilePath = path.resolve(cachedFilePath);
          fileUri = `file://${absoluteFilePath}`;
        }

        // Get the original filename from the request or cached file
        let originalFilename = body.filename || cachedFile;

        // For cached email files, ensure filename includes .json extension for adapter detection
        if (cachedFile.includes('email') && !originalFilename.endsWith('.json')) {
          originalFilename = `${originalFilename}.json`;
        }

        console.log(`[ViewerDownload] Preview URL: ${previewUrl}`);
        console.log('[ViewerDownload] ========================================\n');

        return reply.send({
          success: true,
          data: {
            id: cacheKey,
            name: originalFilename,
            mimeType: contentType,
            previewUrl,
            fileUri,
            absolutePath: absoluteFilePath,
            size: fileSize,
            cached: true,
          },
        });
      }

      // If this was a cache ID but we couldn't find the file, try with common extensions
      // Use tempStorage abstraction to handle both S3 and local filesystem
      if (isCacheId) {
        console.log(`[ViewerDownload] Cache miss for cache ID. Trying with common extensions...`);
        const commonExtensions = ['json', 'pdf', 'txt', 'html', 'md'];

        for (const ext of commonExtensions) {
          const filename = `${cacheKey}.${ext}`;

          try {
            // Read file using tempStorage abstraction (handles both S3 and local FS)
            let fileBuffer: Buffer | null;
            let fileSize: number;

            if (tempStorage.getStorageType() === 's3') {
              fileBuffer = await tempStorage.readTempFile(filename);
              if (!fileBuffer) {
                continue; // File doesn't exist with this extension
              }
              fileSize = fileBuffer.length;
            } else {
              // For local filesystem, verify file exists using fs.stat
              const filepath = path.join(tempDir, filename);
              const stats = await fs.stat(filepath);
              fileSize = stats.size;
            }

            console.log(`[ViewerDownload] Found file with extension .${ext}: ${filename}`);

            const contentTypes: Record<string, string> = {
              pdf: 'application/pdf',
              json: 'application/json',
              txt: 'text/plain',
              html: 'text/html',
              md: 'text/markdown',
            };

            const contentType = contentTypes[ext] || 'application/octet-stream';
            const previewUrl = `/api/viewer/temp/${filename}`;

            // Determine fileUri and absolutePath based on storage type
            let absoluteFilePath: string;
            let fileUri: string;

            if (tempStorage.getStorageType() === 's3') {
              absoluteFilePath = previewUrl;
              fileUri = previewUrl;
            } else {
              const filepath = path.join(tempDir, filename);
              absoluteFilePath = path.resolve(filepath);
              fileUri = `file://${absoluteFilePath}`;
            }

            let originalFilename = body.filename || filename;
            if (ext === 'json' && originalFilename.includes('email')) {
              originalFilename = originalFilename.endsWith('.json') ? originalFilename : `${originalFilename}.json`;
            }

            console.log(`[ViewerDownload] Cache recovery successful with .${ext} extension`);
            console.log('[ViewerDownload] ========================================\n');

            return reply.send({
              success: true,
              data: {
                id: cacheKey,
                name: originalFilename,
                mimeType: contentType,
                previewUrl,
                fileUri,
                absolutePath: absoluteFilePath,
                size: fileSize,
                cached: true,
              },
            });
          } catch {
            // File doesn't exist with this extension, try next one
          }
        }

        // If this is a Gmail cache ID, try to fetch from Gmail API and re-cache
        if (isGmailCacheId(cacheKey)) {
          const messageId = getGmailMessageIdFromCacheId(cacheKey);
          if (messageId) {
            console.log(`[ViewerDownload] Gmail cache miss, attempting to fetch from Gmail API: ${messageId}`);

            try {
              // Get all Google OAuth tokens for this user (multi-account support)
              // Try each account until one successfully fetches the email
              const mainDb = await getMainDatabase(config.storage.root);
              const allTokens = await mainDb.getAllUserOAuthTokens(request.user.id, 'google-gmail');

              if (allTokens.length === 0) {
                console.log('[ViewerDownload] No Google Gmail OAuth tokens found for Gmail recovery');
                return reply.code(403).send({
                  success: false,
                  error: {
                    message: 'Google authentication required to fetch this email.',
                    authRequired: true,
                    authProvider: 'google'
                  }
                });
              }

              console.log(`[ViewerDownload] Trying ${allTokens.length} Google account(s) for Gmail recovery`);

              let lastError: Error | null = null;
              let success = false;
              let filename: string = '';
              let data: Buffer = Buffer.alloc(0);

              for (const oauthToken of allTokens) {
                console.log(`[ViewerDownload] Trying Google account: ${oauthToken.accountEmail}`);

                // Prepare tokens for the Gmail API (convert null to undefined for type compatibility)
                const tokens = {
                  access_token: oauthToken.accessToken,
                  refresh_token: oauthToken.refreshToken || undefined,
                  expiry_date: oauthToken.expiryDate || undefined,
                  token_type: 'Bearer',
                };

                try {
                  // Fetch and cache the Gmail message
                  const result = await fetchAndCacheGmailMessage(messageId, tokens);
                  filename = result.filename;
                  data = result.data;
                  success = true;
                  console.log(`[ViewerDownload] Successfully fetched email using account: ${oauthToken.accountEmail}`);
                  break;
                } catch (accountError: any) {
                  // If we get 404, this account doesn't have access - try the next one
                  // For other errors (network, rate limit, etc.), propagate immediately
                  const errorStatus = accountError?.response?.status || accountError?.status;
                  if (errorStatus === 404) {
                    console.log(`[ViewerDownload] Account ${oauthToken.accountEmail} returned 404, trying next account`);
                    lastError = accountError;
                    continue;
                  }
                  // Non-404 error - don't bother trying other accounts
                  throw accountError;
                }
              }

              if (!success) {
                // All accounts returned 404 - the message doesn't exist or user lost access
                console.log('[ViewerDownload] All Google accounts returned 404 for this message');
                return reply.code(404).send({
                  success: false,
                  error: {
                    message: 'Email not found. It may have been deleted or you may have lost access to it.',
                    cacheId: cacheKey
                  }
                });
              }

              // Write the re-cached email to temp storage
              await tempStorage.writeTempFile(filename, data);
              console.log(`[ViewerDownload] Successfully re-cached Gmail email: ${filename}`);

              // Return the cached file
              const contentType = 'application/json';
              const previewUrl = `/api/viewer/temp/${filename}`;

              return reply.send({
                success: true,
                data: {
                  id: cacheKey,
                  name: filename,
                  mimeType: contentType,
                  previewUrl,
                  fileUri: previewUrl,
                  absolutePath: previewUrl,
                  size: data.length,
                  cached: true,
                },
              });
            } catch (gmailError) {
              console.error('[ViewerDownload] Gmail recovery failed:', gmailError);
              return reply.code(500).send({
                success: false,
                error: {
                  message: `Failed to fetch email from Gmail: ${gmailError instanceof Error ? gmailError.message : String(gmailError)}`,
                  cacheId: cacheKey
                }
              });
            }
          }
        }

        console.error(`[ViewerDownload] ERROR: Cache ID not found in temp storage: ${cacheKey}`);
        return reply.code(404).send({
          success: false,
          error: {
            message: `Cached file not found: ${cacheKey}. The file may have been deleted or expired.`,
            cacheId: cacheKey
          }
        });
      }

      console.log(`[ViewerDownload] Cache miss. Downloading file...`);

      let buffer: Buffer;
      let contentType = body.mimeType || 'application/octet-stream';
      let filename = body.filename || 'downloaded-file';

      if (gdriveFileId) {
        console.log(`[ViewerDownload] Detected Google Drive file ID: ${gdriveFileId}`);

        // Get user's Google Drive OAuth token
        let oauthToken = await authService.getOAuthToken(request.user!.id, 'google-drive');

        if (!oauthToken) {
          console.log('[ViewerDownload] ERROR: No Google Drive OAuth token found for user');
          return reply.code(403).send({
            success: false,
            error: {
              message: 'Google authentication required to download files. Please authenticate with Google first.',
              authRequired: true,
              authProvider: 'google'
            }
          });
        }

        console.log(`[ViewerDownload] Using Google OAuth token for download`);
        console.log(`[ViewerDownload] Access token length: ${oauthToken.accessToken.length}`);
        console.log(`[ViewerDownload] Access token prefix: ${oauthToken.accessToken.substring(0, 10)}...`);
        console.log(`[ViewerDownload] Access token suffix: ...${oauthToken.accessToken.substring(oauthToken.accessToken.length - 10)}`);
        console.log(`[ViewerDownload] Token expiry date: ${oauthToken.expiryDate ? new Date(oauthToken.expiryDate).toISOString() : 'not set'}`);
        console.log(`[ViewerDownload] Has refresh token: ${!!oauthToken.refreshToken}`);
        console.log(`[ViewerDownload] Refresh token length: ${oauthToken.refreshToken?.length || 0}`);
        console.log(`[ViewerDownload] Token provider: ${oauthToken.provider}`);

        // Check if token is expired and refresh if needed
        const now = Date.now();
        const tokenExpired = oauthToken.expiryDate && oauthToken.expiryDate < now;

        if (tokenExpired) {
          console.log('[ViewerDownload] Token is expired, attempting refresh...');

          if (!oauthToken.refreshToken) {
            console.log('[ViewerDownload] ERROR: Token expired and no refresh token available');
            return reply.code(403).send({
              success: false,
              error: {
                message: 'Google authentication expired. Please re-authenticate with Google.',
                authRequired: true,
                authProvider: 'google'
              }
            });
          }

          try {
            // Create Google OAuth handler for token refresh
            const googleOAuth = new GoogleOAuthHandler({
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
              redirectUri: config.google.redirectUri,
            });

            console.log('[ViewerDownload] Refreshing access token...');
            const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);

            // Update stored token
            oauthToken = await authService.storeOAuthToken(request.user!.id, {
              provider: 'google',
              accessToken: newTokens.access_token,
              refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
              expiryDate: Date.now() + (newTokens.expires_in * 1000),
            } as any);

            console.log(`[ViewerDownload] Token refreshed successfully. New expiry: ${new Date(oauthToken.expiryDate!).toISOString()}`);
          } catch (refreshError) {
            console.error('[ViewerDownload] Failed to refresh token:', refreshError);
            return reply.code(403).send({
              success: false,
              error: {
                message: 'Failed to refresh Google authentication. Please re-authenticate with Google.',
                authRequired: true,
                authProvider: 'google'
              }
            });
          }
        }

        // First, check if file exists by fetching metadata
        const metadataUrl = `https://www.googleapis.com/drive/v3/files/${gdriveFileId}?supportsAllDrives=true&fields=id,name,mimeType,webContentLink`;
        console.log(`[ViewerDownload] Fetching file metadata: ${metadataUrl}`);

        let metadataResponse = await fetch(metadataUrl, {
          headers: {
            'Authorization': `Bearer ${oauthToken.accessToken}`,
          },
        });

        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json() as any;
          console.log(`[ViewerDownload] File metadata:`, JSON.stringify(metadata));
          console.log(`[ViewerDownload] File name: ${metadata.name}`);
          console.log(`[ViewerDownload] File MIME type: ${metadata.mimeType}`);
          console.log(`[ViewerDownload] Web content link: ${metadata.webContentLink}`);
        } else {
          const errorText = await metadataResponse.text();
          console.log(`[ViewerDownload] Metadata fetch failed: ${metadataResponse.status}`);
          console.log(`[ViewerDownload] Error: ${errorText.substring(0, 300)}`);
        }

        // Use Google Drive API to download the file
        // Note: supportsAllDrives=true allows access to Shared Drives and shared files
        const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${gdriveFileId}?alt=media&supportsAllDrives=true`;
        console.log(`[ViewerDownload] Fetching from Drive API: ${driveApiUrl}`);

        let response = await fetch(driveApiUrl, {
          headers: {
            'Authorization': `Bearer ${oauthToken.accessToken}`,
          },
        });

        // If still getting 401 after refresh, try refreshing once more
        if (response.status === 401 && oauthToken.refreshToken) {
          console.log('[ViewerDownload] Got 401, attempting another token refresh...');

          try {
            const googleOAuth = new GoogleOAuthHandler({
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
              redirectUri: config.google.redirectUri,
            });

            const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);

            oauthToken = await authService.storeOAuthToken(request.user!.id, {
              provider: 'google',
              accessToken: newTokens.access_token,
              refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
              expiryDate: Date.now() + (newTokens.expires_in * 1000),
            } as any);

            console.log(`[ViewerDownload] Token refreshed again. Retrying download...`);

            // Retry the request with new token using the same URL with supportsAllDrives
            response = await fetch(`https://www.googleapis.com/drive/v3/files/${gdriveFileId}?alt=media&supportsAllDrives=true`, {
              headers: {
                'Authorization': `Bearer ${oauthToken.accessToken}`,
              },
            });
          } catch (refreshError) {
            console.error('[ViewerDownload] Second refresh attempt failed:', refreshError);
          }
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`[ViewerDownload] ERROR: Drive API failed: ${response.status} ${response.statusText}`);
          console.log(`[ViewerDownload] Error response: ${errorText.substring(0, 500)}`);
          console.log(`[ViewerDownload] Response headers:`);
          for (const [key, value] of response.headers) {
            if (key.toLowerCase().includes('auth') || key.toLowerCase().includes('www-authenticate')) {
              console.log(`[ViewerDownload]   ${key}: ${value}`);
            }
          }

          // Check if token might be expired
          if (response.status === 401) {
            return reply.code(403).send({
              success: false,
              error: {
                message: 'Google authentication expired. Please re-authenticate with Google.',
                authRequired: true,
                authProvider: 'google'
              }
            });
          }

          return reply.code(400).send({ success: false, error: { message: `Failed to fetch file from Google Drive: ${response.statusText}` } });
        }

        // Get content type from response
        contentType = response.headers.get('content-type') || body.mimeType || 'application/octet-stream';
        console.log(`[ViewerDownload] Content-Type from Drive API: ${contentType}`);

        // Get filename from Content-Disposition header if available
        const contentDisposition = response.headers.get('content-disposition');
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-\d['"]*)?([^"';\r\n]+)/);
          if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1]);
            console.log(`[ViewerDownload] Filename from Content-Disposition: ${filename}`);
          }
        }

        // If no filename from header, use the provided one or generate from file ID
        if (!filename || filename === 'downloaded-file') {
          filename = body.filename || `document-${gdriveFileId.substring(0, 8)}.pdf`;
        }

        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        console.log(`[ViewerDownload] Downloaded ${buffer.length} bytes from Drive API`);
      } else {
        // Regular URL download (non-Google Drive)
        console.log(`[ViewerDownload] Fetching file from URL...`);
        const response = await fetch(body.url);

        if (!response.ok) {
          console.log(`[ViewerDownload] ERROR: Failed to fetch: ${response.status} ${response.statusText}`);
          return reply.code(400).send({ success: false, error: { message: `Failed to fetch file: ${response.statusText}` } });
        }

        contentType = body.mimeType || response.headers.get('content-type') || 'application/octet-stream';
        console.log(`[ViewerDownload] Content-Type: ${contentType}`);

        const urlPath = new URL(body.url).pathname;
        const defaultFilename = urlPath.split('/').pop() || 'downloaded-file';
        filename = body.filename || defaultFilename;

        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      // Generate filename with cache key (no timestamp needed)
      const fileExtension = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
      const tempFilename = sanitizeFilename(`${cacheKey}${fileExtension}`);
      const tempFilePath = path.join(tempDir, tempFilename);
      console.log(`[ViewerDownload] Temp file path: ${tempFilePath}`);

      // Write file to temp storage using TempStorage abstraction (supports S3)
      console.log(`[ViewerDownload] File size: ${buffer.length} bytes`);
      await tempStorage.writeTempFile(tempFilename, buffer);
      console.log(`[ViewerDownload] File written successfully to temp storage`);

      // Return the local URL for preview
      const previewUrl = `/api/viewer/temp/${tempFilename}`;

      // Get absolute path for markitdown file:// URI
      // Handle both S3 and local filesystem storage types
      let absoluteFilePath: string;
      let fileUri: string;

      if (tempStorage.getStorageType() === 's3') {
        // For S3, we can't return a local file:// URI
        // Use the preview URL as the URI instead
        absoluteFilePath = previewUrl;
        fileUri = previewUrl;
      } else {
        absoluteFilePath = path.resolve(tempFilePath);
        fileUri = `file://${absoluteFilePath}`;
      }

      console.log(`[ViewerDownload] Preview URL: ${previewUrl}`);
      console.log(`[ViewerDownload] File URI for markitdown: ${fileUri}`);
      console.log('[ViewerDownload] ========================================\n');

      return reply.send({
        success: true,
        data: {
          id: cacheKey,
          name: filename,
          mimeType: contentType,
          previewUrl,
          fileUri,  // Add file:// URI for use with convert_to_markdown
          absolutePath: absoluteFilePath,  // Also provide raw path
          size: buffer.length,
          cached: false,
        },
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to download file for preview');
      console.log(`[ViewerDownload] ERROR: ${error}`);
      console.log('[ViewerDownload] ========================================\n');
      return reply.code(500).send({ success: false, error: { message: 'Failed to download file' } });
    }
  });

  // Serve temp files for preview
  fastify.get('/viewer/temp/:filename', async (request, reply) => {
    const params = request.params as { filename: string };
    const tempDir = path.join(config.storage.root, 'temp');

    // Security: Validate filename to prevent path traversal attacks
    const filename = params.filename;

    // Reject filenames with path separators or parent directory references
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      console.log(`[ViewerTemp] SECURITY: Rejected path traversal attempt: ${filename}`);
      return reply.code(400).send({ success: false, error: { message: 'Invalid filename' } });
    }

    // Reject absolute paths
    if (path.isAbsolute(filename)) {
      console.log(`[ViewerTemp] SECURITY: Rejected absolute path: ${filename}`);
      return reply.code(400).send({ success: false, error: { message: 'Invalid filename' } });
    }

    // Determine content type based on file extension
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const contentTypes: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      html: 'text/html',
      txt: 'text/plain',
      json: 'application/json',
      md: 'text/markdown',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    try {
      let fileBuffer: Buffer | null;

      // Check storage type and read from appropriate location
      if (tempStorage.getStorageType() === 's3') {
        // Read from S3
        fileBuffer = await tempStorage.readTempFile(filename);
        if (!fileBuffer) {
          return reply.code(404).send({ success: false, error: { message: 'File not found in S3' } });
        }
      } else {
        // Read from local filesystem
        const filePath = path.join(tempDir, filename);

        // Security: Verify the resolved path is still within temp directory
        const resolvedPath = path.resolve(filePath);
        const resolvedTempDir = path.resolve(tempDir);
        if (!resolvedPath.startsWith(resolvedTempDir + path.sep) && resolvedPath !== resolvedTempDir) {
          console.log(`[ViewerTemp] SECURITY: Path escape attempt - resolved to: ${resolvedPath}`);
          return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
        }

        const fs = await import('fs/promises');
        try {
          fileBuffer = await fs.readFile(filePath);
        } catch {
          return reply.code(404).send({ success: false, error: { message: 'File not found' } });
        }
      }

      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileBuffer.length);
      reply.header('Content-Disposition', `inline; filename="${filename}"`);
      return reply.send(fileBuffer);
    } catch (error) {
      console.error('[ViewerTemp] Error serving file:', error);
      return reply.code(500).send({ success: false, error: { message: 'Internal server error' } });
    }
  });
}
