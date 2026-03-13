import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DialogOverlay } from '../../components/DialogOverlay';

describe('DialogOverlay', () => {
  it('renders children', () => {
    render(
      <DialogOverlay onClose={vi.fn()}>
        <div>Dialog Content</div>
      </DialogOverlay>,
    );
    expect(screen.getByText('Dialog Content')).toBeInTheDocument();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <DialogOverlay onClose={onClose}>
        <div>Content</div>
      </DialogOverlay>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose for other keys', () => {
    const onClose = vi.fn();
    render(
      <DialogOverlay onClose={onClose}>
        <div>Content</div>
      </DialogOverlay>,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the backdrop itself is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <DialogOverlay onClose={onClose}>
        <div>Content</div>
      </DialogOverlay>,
    );
    // Click the backdrop div directly (target === currentTarget)
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose when inner content is clicked', () => {
    const onClose = vi.fn();
    render(
      <DialogOverlay onClose={onClose}>
        <div>Inner Content</div>
      </DialogOverlay>,
    );
    // Clicking a child — target !== currentTarget, so onClose should NOT fire
    fireEvent.click(screen.getByText('Inner Content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the Escape key listener after unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <DialogOverlay onClose={onClose}>
        <div>Content</div>
      </DialogOverlay>,
    );
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('applies a custom className to the backdrop', () => {
    const { container } = render(
      <DialogOverlay onClose={vi.fn()} className="my-custom-class">
        <div>Content</div>
      </DialogOverlay>,
    );
    expect(container.firstElementChild?.className).toContain('my-custom-class');
  });

  it('uses the default flex layout when no className is supplied', () => {
    const { container } = render(
      <DialogOverlay onClose={vi.fn()}>
        <div>Content</div>
      </DialogOverlay>,
    );
    const backdrop = container.firstElementChild!;
    expect(backdrop.className).toContain('flex');
    expect(backdrop.className).toContain('items-center');
    expect(backdrop.className).toContain('justify-center');
  });

  it('always renders with fixed inset overlay classes', () => {
    const { container } = render(
      <DialogOverlay onClose={vi.fn()}>
        <div>Content</div>
      </DialogOverlay>,
    );
    const backdrop = container.firstElementChild!;
    expect(backdrop.className).toContain('fixed');
    expect(backdrop.className).toContain('inset-0');
    expect(backdrop.className).toContain('z-50');
  });
});
