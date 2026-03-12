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
      className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 ${className}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}
