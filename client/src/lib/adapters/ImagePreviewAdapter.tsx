/**
 * Image Preview Adapter
 *
 * Renders image files (PNG, JPEG, GIF, SVG, WebP) with zoom and fit-to-window controls
 */

import React, { useState } from 'react';
import { PreviewAdapter } from '../preview-adapters';
import { ViewerFile } from '../../store';

/**
 * Image Preview Component
 * Manages image rendering and zoom
 */
function ImagePreviewComponent({ file, containerWidth }: { file: ViewerFile; containerWidth: number }) {
  const [scale, setScale] = useState(1.0);
  const [fitToWindow, setFitToWindow] = useState(true);

  return (
    <>
      {/* Image Controls */}
      <div className="flex items-center justify-center gap-4 py-2 border-b bg-muted/30 px-4">
        <button
          onClick={() => setFitToWindow(!fitToWindow)}
          className={`px-3 py-1 text-sm rounded ${
            fitToWindow
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'
          }`}
          title="Toggle fit to window"
        >
          {fitToWindow ? 'Fit' : 'Actual'}
        </button>

        {!fitToWindow && (
          <div className="border-l pl-4 ml-2 flex items-center gap-2">
            <button
              onClick={() => setScale(prev => Math.max(prev - 0.1, 0.1))}
              className="px-2 py-1 text-sm rounded bg-muted hover:bg-muted/80"
              title="Zoom out"
            >
              −
            </button>
            <span className="text-sm w-12 text-center">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale(prev => Math.min(prev + 0.1, 3.0))}
              className="px-2 py-1 text-sm rounded bg-muted hover:bg-muted/80"
              title="Zoom in"
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Image Viewer */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <img
          src={file.previewUrl}
          alt={file.name}
          style={
            fitToWindow
              ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
              : { width: `${containerWidth * scale}px`, objectFit: 'contain' }
          }
          className="rounded"
          onError={() => console.error(`Failed to load image: ${file.name}`)}
        />
      </div>
    </>
  );
}

/**
 * Image Preview Adapter
 * Handles image MIME types (PNG, JPEG, GIF, SVG, WebP)
 */
export class ImagePreviewAdapter implements PreviewAdapter {
  readonly id = 'image-preview';
  readonly name = 'Image Viewer';

  canHandle(file: ViewerFile): boolean {
    return file.mimeType.startsWith('image/');
  }

  render(file: ViewerFile, containerWidth: number): React.ReactNode {
    return <ImagePreviewComponent file={file} containerWidth={containerWidth} />;
  }
}
