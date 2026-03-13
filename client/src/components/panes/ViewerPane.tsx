import { useUIStore } from '../../store';
import { useRef, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { TopBanner } from '../TopBanner';
import { previewAdapterRegistry } from '../../lib/preview-adapters';

export { SettingsDialog } from '../settings/SettingsDialog';

export function ViewerPane({ onClose }: { onClose?: () => void }) {
  const { viewerFile } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(600);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const adapter = viewerFile ? previewAdapterRegistry.findAdapter(viewerFile) : undefined;
  const previewContent = adapter && viewerFile ? adapter.render(viewerFile, containerWidth) : null;

  const displayFileName = viewerFile?.name?.endsWith('.json') && viewerFile?.name?.length > 5
    ? viewerFile.name.slice(0, -5)
    : viewerFile?.name;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      <TopBanner
        fileName={displayFileName}
        sourceUrl={viewerFile?.sourceUrl}
        openInNewWindowLabel="Open in New Window"
      >
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </TopBanner>

      <div ref={containerRef} className="flex flex-col flex-1 overflow-hidden">
        {viewerFile ? (
          previewContent ? (
            previewContent
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <p className="text-sm font-semibold mb-2">Unsupported File Type</p>
                <p className="text-xs text-muted-foreground">
                  No preview available for {viewerFile.mimeType || 'this file type'}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Supported: PDF, Images, Text, Markdown
                </p>
              </div>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">Document Preview</p>
              <p className="text-xs text-muted-foreground mt-1">
                Documents shared from the chat will appear here
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
