/**
 * Preview Adapter System
 *
 * Extensible architecture for rendering different file types in the preview pane.
 * Each file type (PDF, Image, HTML, Markdown, etc.) has its own adapter that
 * knows how to render and interact with that content.
 */

import { ViewerFile } from '../store';

/**
 * Interface for preview adapters
 * Each adapter handles rendering and interactions for a specific content type
 */
export interface PreviewAdapter {
  /**
   * Unique identifier for this adapter
   */
  readonly id: string;

  /**
   * Display name for this adapter
   */
  readonly name: string;

  /**
   * Check if this adapter can handle the given file
   */
  canHandle(file: ViewerFile): boolean;

  /**
   * Render the preview component for this file
   * @param file The file to preview
   * @param containerWidth Width of the container in pixels
   */
  render(file: ViewerFile, containerWidth: number): React.ReactNode;
}

/**
 * Registry for preview adapters
 * Maps MIME types and file extensions to appropriate adapters
 */
class PreviewAdapterRegistry {
  private adapters: Map<string, PreviewAdapter> = new Map();
  private mimeTypeMap: Map<string, string> = new Map(); // mimeType -> adapterId
  private extensionMap: Map<string, string> = new Map(); // extension -> adapterId

  /**
   * Register a preview adapter
   */
  register(adapter: PreviewAdapter, options: {
    mimeTypes?: string[];
    extensions?: string[];
  } = {}): void {
    this.adapters.set(adapter.id, adapter);

    // Register MIME type mappings
    if (options.mimeTypes) {
      for (const mimeType of options.mimeTypes) {
        this.mimeTypeMap.set(mimeType, adapter.id);
      }
    }

    // Register extension mappings
    if (options.extensions) {
      for (const ext of options.extensions) {
        this.extensionMap.set(ext.toLowerCase(), adapter.id);
      }
    }

    console.log(`[PreviewAdapterRegistry] Registered adapter: ${adapter.id}`);
  }

  /**
   * Get adapter by ID
   */
  getAdapter(id: string): PreviewAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Find the best adapter for a file
   * Priority: MIME type match > extension match > canHandle() check > fallback
   */
  findAdapter(file: ViewerFile): PreviewAdapter | undefined {
    // Try MIME type first, but also validate with canHandle()
    if (file.mimeType) {
      const adapterId = this.mimeTypeMap.get(file.mimeType);
      if (adapterId) {
        const adapter = this.adapters.get(adapterId);
        if (adapter && adapter.canHandle(file)) {
          return adapter;
        }
      }
    }

    // Try file extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext) {
      const adapterId = this.extensionMap.get(ext);
      if (adapterId) {
        const adapter = this.adapters.get(adapterId);
        if (adapter && adapter.canHandle(file)) {
          return adapter;
        }
      }
    }

    // Fall back to canHandle() check on all adapters
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(file)) {
        return adapter;
      }
    }

    return undefined;
  }

  /**
   * Get all registered adapters (for UI or debugging)
   */
  getAllAdapters(): PreviewAdapter[] {
    return Array.from(this.adapters.values());
  }
}

// Global registry instance
export const previewAdapterRegistry = new PreviewAdapterRegistry();

/**
 * Helper to get file extension
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

/**
 * Helper to determine MIME type from filename
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = getFileExtension(filename);
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    htm: 'text/html',
    xml: 'application/xml',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
