/**
 * PDF Preview Adapter
 *
 * Renders PDF files using react-pdf library with zoom and page controls
 */

import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { PreviewAdapter } from '../preview-adapters';
import { ViewerFile } from '../../store';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

/**
 * PDF Preview Component
 * Manages PDF rendering, zooming, and page navigation
 */
function PdfPreviewComponent({ file, containerWidth }: { file: ViewerFile; containerWidth: number }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1.0);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNumPages(null);
  }, [file.previewUrl]);

  // Configure all links in PDF to open in new windows
  useEffect(() => {
    if (!pdfContainerRef.current) return;

    const handleLinkClick = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'A' || target.closest('a')) {
        const link = target.tagName === 'A' ? (target as HTMLAnchorElement) : (target.closest('a') as HTMLAnchorElement);
        if (link && link.href) {
          event.preventDefault();
          window.open(link.href, '_blank', 'noopener,noreferrer');
        }
      }
    };

    const container = pdfContainerRef.current;
    container.addEventListener('click', handleLinkClick, true);

    return () => {
      container.removeEventListener('click', handleLinkClick, true);
    };
  }, []);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const pages = numPages ? Array.from({ length: numPages }, (_, i) => i + 1) : [];

  return (
    <>
      {/* PDF Controls */}
      {numPages && (
        <div className="flex items-center justify-center gap-4 py-2 border-b bg-muted/30 px-4">
          <span className="text-sm text-muted-foreground">
            {numPages} page{numPages !== 1 ? 's' : ''}
          </span>
          <div className="border-l pl-4 ml-2 flex items-center gap-2">
            <button
              onClick={() => setScale(prev => Math.max(prev - 0.1, 0.5))}
              className="px-2 py-1 text-sm rounded bg-muted hover:bg-muted/80"
              title="Zoom out"
            >
              −
            </button>
            <span className="text-sm w-12 text-center">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale(prev => Math.min(prev + 0.1, 2.0))}
              className="px-2 py-1 text-sm rounded bg-muted hover:bg-muted/80"
              title="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* PDF Viewer */}
      <div ref={pdfContainerRef} className="flex-1 overflow-auto flex flex-col items-center py-4 gap-2">
        <Document
          file={file.previewUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading PDF...</p>
            </div>
          }
          error={
            <div className="flex items-center justify-center h-64">
              <p className="text-destructive">Failed to load PDF</p>
            </div>
          }
        >
          {pages.map((pageNum) => (
            <Page
              key={pageNum}
              pageNumber={pageNum}
              width={containerWidth * scale}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              className="mb-2"
            />
          ))}
        </Document>
      </div>
    </>
  );
}

/**
 * PDF Preview Adapter
 * Handles application/pdf MIME type
 */
export class PdfPreviewAdapter implements PreviewAdapter {
  readonly id = 'pdf-preview';
  readonly name = 'PDF Viewer';

  canHandle(file: ViewerFile): boolean {
    return file.mimeType === 'application/pdf' || file.name.endsWith('.pdf');
  }

  render(file: ViewerFile, containerWidth: number): React.ReactNode {
    return <PdfPreviewComponent file={file} containerWidth={containerWidth} />;
  }
}
