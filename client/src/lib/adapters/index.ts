/**
 * Preview Adapters
 *
 * Centralized export and initialization of all preview adapters
 */

import { previewAdapterRegistry } from '../preview-adapters';
import { PdfPreviewAdapter } from './PdfPreviewAdapter';
import { ImagePreviewAdapter } from './ImagePreviewAdapter';
import { TextPreviewAdapter } from './TextPreviewAdapter';
import { EmailPreviewAdapter } from './EmailPreviewAdapter';

/**
 * Initialize all built-in preview adapters
 * This is called once on app startup
 */
export function initializePreviewAdapters(): void {
  // PDF adapter
  const pdfAdapter = new PdfPreviewAdapter();
  previewAdapterRegistry.register(pdfAdapter, {
    mimeTypes: ['application/pdf'],
    extensions: ['pdf'],
  });

  // Image adapter
  const imageAdapter = new ImagePreviewAdapter();
  previewAdapterRegistry.register(imageAdapter, {
    mimeTypes: [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/svg+xml',
      'image/webp',
    ],
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'],
  });

  // Email adapter - will use canHandle() to detect email JSON files
  const emailAdapter = new EmailPreviewAdapter();
  previewAdapterRegistry.register(emailAdapter, {
    mimeTypes: [
      'message/rfc822',
      'message/partial',
    ],
    extensions: ['eml', 'msg', 'mbox'],
  });

  // Text adapter (note: application/json handled by canHandle() to allow EmailAdapter priority)
  const textAdapter = new TextPreviewAdapter();
  previewAdapterRegistry.register(textAdapter, {
    mimeTypes: [
      'text/plain',
      'text/markdown',
      'text/html',
      'text/xml',
      'application/xml',
    ],
    extensions: ['txt', 'md', 'markdown', 'html', 'htm', 'xml'],
  });

  console.log('[PreviewAdapters] Initialized all built-in adapters');
}

// Export for easy adapter registration in the future
export { previewAdapterRegistry } from '../preview-adapters';
export type { PreviewAdapter } from '../preview-adapters';
export { PdfPreviewAdapter } from './PdfPreviewAdapter';
export { ImagePreviewAdapter } from './ImagePreviewAdapter';
export { TextPreviewAdapter } from './TextPreviewAdapter';
export { EmailPreviewAdapter } from './EmailPreviewAdapter';
export type { EmailMessage, EmailThread, EmailAttachment } from './types';
