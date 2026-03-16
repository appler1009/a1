import { useEffect } from 'react';

interface DialogOverlayProps {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export function DialogOverlay({ onClose, children, className = 'flex items-center justify-center' }: DialogOverlayProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center max-sm:bg-transparent max-sm:[&>*]:absolute max-sm:[&>*]:inset-0 max-sm:[&>*]:!w-full max-sm:[&>*]:!h-full max-sm:[&>*]:!max-w-none max-sm:[&>*]:!max-h-none max-sm:[&>*]:!rounded-none ${className}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}
