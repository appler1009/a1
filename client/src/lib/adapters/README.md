# Preview Adapter System

An extensible, plugin-based architecture for rendering different file types in the preview pane.

## Overview

The preview adapter system allows you to add support for new file types without modifying the core ViewerPane component. Each file type (PDF, Image, Text, etc.) is handled by a specialized adapter that knows how to render and interact with that content.

## Architecture

### Core Components

1. **PreviewAdapter Interface** (`preview-adapters.ts`)
   - Defines the contract for all preview adapters
   - Each adapter must implement: `id`, `name`, `canHandle()`, and `render()`

2. **PreviewAdapterRegistry** (`preview-adapters.ts`)
   - Manages adapter registration and lookup
   - Maps MIME types and file extensions to adapters
   - Uses priority-based adapter selection

3. **ViewerPane** (`../ViewerPane.tsx`)
   - Generic container component
   - Delegates rendering to the appropriate adapter
   - Handles common UI elements (top banner, container layout)

## Built-in Adapters

### 1. PDF Adapter (`PdfPreviewAdapter.tsx`)
- **MIME Type**: `application/pdf`
- **Extensions**: `.pdf`
- **Features**: Page navigation, zoom controls, text selection
- **Library**: `react-pdf`

### 2. Image Adapter (`ImagePreviewAdapter.tsx`)
- **MIME Types**: `image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`, `image/webp`
- **Extensions**: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`
- **Features**: Zoom controls, fit-to-window toggle
- **Method**: Native `<img>` element

### 3. Text Adapter (`TextPreviewAdapter.tsx`)
- **MIME Types**: `text/plain`, `text/markdown`, `text/html`, `text/xml`, `application/json`
- **Extensions**: `.txt`, `.md`, `.html`, `.json`, `.xml`
- **Features**: Font size adjustment, word wrap toggle, syntax-aware rendering
- **Method**: `<pre>` element with monospace font

## How to Add a New Adapter

### Step 1: Create the Adapter Component

Create a new file in this directory (e.g., `VideoPreviewAdapter.tsx`):

```typescript
import React from 'react';
import { PreviewAdapter } from '../preview-adapters';
import { ViewerFile } from '../../store';

function VideoPreviewComponent({ file }: { file: ViewerFile }) {
  return (
    <div className="flex-1 overflow-auto flex items-center justify-center p-4">
      <video
        src={file.previewUrl}
        controls
        style={{ maxWidth: '100%', maxHeight: '100%' }}
      />
    </div>
  );
}

export class VideoPreviewAdapter implements PreviewAdapter {
  readonly id = 'video-preview';
  readonly name = 'Video Viewer';

  canHandle(file: ViewerFile): boolean {
    return file.mimeType.startsWith('video/');
  }

  render(file: ViewerFile): React.ReactNode {
    return <VideoPreviewComponent file={file} />;
  }
}
```

### Step 2: Register the Adapter

Update `index.ts` to register your adapter:

```typescript
import { VideoPreviewAdapter } from './VideoPreviewAdapter';

export function initializePreviewAdapters(): void {
  // ... existing adapters ...

  // Video adapter
  const videoAdapter = new VideoPreviewAdapter();
  previewAdapterRegistry.register(videoAdapter, {
    mimeTypes: [
      'video/mp4',
      'video/webm',
      'video/ogg',
    ],
    extensions: ['mp4', 'webm', 'ogv', 'mov'],
  });
}
```

### Step 3: Update MIME Type Mappings

If needed, add MIME type detection in `preview-adapters.ts`:

```typescript
export function getMimeTypeFromExtension(filename: string): string {
  const ext = getFileExtension(filename);
  const mimeTypes: Record<string, string> = {
    // ... existing mappings ...
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
```

## Adapter Interface Reference

```typescript
export interface PreviewAdapter {
  /**
   * Unique identifier for this adapter
   * Used internally for logging and debugging
   */
  readonly id: string;

  /**
   * Display name for this adapter
   * Can be shown in UI if needed
   */
  readonly name: string;

  /**
   * Determine if this adapter can handle the given file
   * Called as a fallback when MIME type and extension matching fail
   *
   * @param file - The file to check
   * @returns true if this adapter can render the file
   */
  canHandle(file: ViewerFile): boolean;

  /**
   * Render the preview component for this file
   * Return a React component that handles display, interaction, etc.
   *
   * @param file - The file to preview
   * @param containerWidth - Width of the preview container in pixels
   * @returns React component or null
   */
  render(file: ViewerFile, containerWidth: number): React.ReactNode;
}
```

## Adapter Selection Priority

When determining which adapter to use for a file, the registry follows this priority:

1. **MIME Type Match** (fastest, most reliable)
   - Direct lookup by `file.mimeType`
   - Example: `application/pdf` → PDF Adapter

2. **Extension Match**
   - Lookup by file extension from `file.name`
   - Example: `.pdf` → PDF Adapter
   - Uses case-insensitive comparison

3. **Fallback Check**
   - Calls `canHandle()` on each registered adapter
   - Allows adapters to handle edge cases
   - First match wins

4. **Unsupported File**
   - If no adapter matches, ViewerPane shows "Unsupported File Type" message
   - User sees list of supported types

## Best Practices

### 1. Minimize Bundle Size
- Lazy-load heavy libraries (e.g., PDF.js)
- Use native HTML elements when possible
- Consider extracting large dependencies to separate chunks

### 2. Handle Errors Gracefully
- Show user-friendly error messages
- Log detailed errors to console for debugging
- Provide fallback UI if content fails to load

### 3. Responsive Design
- Use the provided `containerWidth` prop for sizing
- Handle responsive resizing via ResizeObserver
- Test on different screen sizes

### 4. MIME Type Coverage
- Use standard MIME types from IANA registry
- Register multiple MIME types if your format has variants
- Ensure extensions are comprehensive

### 5. User Interaction
- Provide intuitive controls (zoom, pan, etc.)
- Use consistent styling with app theme
- Keyboard shortcuts where applicable

## Example: Markdown Adapter with Rendering

```typescript
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { PreviewAdapter } from '../preview-adapters';
import { ViewerFile } from '../../store';

function MarkdownPreviewComponent({ file }: { file: ViewerFile }) {
  const [content, setContent] = useState('');

  useEffect(() => {
    fetch(file.previewUrl)
      .then(r => r.text())
      .then(setContent)
      .catch(err => console.error('Failed to load markdown:', err));
  }, [file.previewUrl]);

  return (
    <div className="flex-1 overflow-auto p-4 prose dark:prose-invert">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

export class MarkdownPreviewAdapter implements PreviewAdapter {
  readonly id = 'markdown-preview';
  readonly name = 'Markdown Viewer';

  canHandle(file: ViewerFile): boolean {
    return file.mimeType === 'text/markdown';
  }

  render(file: ViewerFile): React.ReactNode {
    return <MarkdownPreviewComponent file={file} />;
  }
}
```

## Testing Your Adapter

1. **Manual Testing**
   - Add test files with your supported extension
   - Click preview links in chat messages
   - Verify rendering and interactions work correctly

2. **Type Checking**
   - Ensure TypeScript compilation passes
   - Run `npm run build` to verify

3. **Performance**
   - Monitor bundle size impact
   - Test with large files (PDFs, videos)
   - Check memory usage during preview

## Future Enhancements

- [ ] Syntax highlighting for code files (`.js`, `.ts`, `.py`, etc.)
- [ ] Spreadsheet preview (`.xlsx`, `.csv`)
- [ ] 3D model viewer (`.gltf`, `.obj`)
- [ ] Audio player (`.mp3`, `.wav`, `.ogg`)
- [ ] Markdown with LaTeX math rendering
- [ ] Dark/light theme support per adapter
- [ ] Print/download capabilities
