import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingOverlay } from '../../components/LoadingOverlay';

describe('LoadingOverlay', () => {
  it('renders the default message', () => {
    render(<LoadingOverlay />);
    expect(screen.getByText('Switching role...')).toBeInTheDocument();
  });

  it('renders a custom message', () => {
    render(<LoadingOverlay message="Loading data..." />);
    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  it('renders a spinner element', () => {
    const { container } = render(<LoadingOverlay />);
    // The Loader2 lucide icon renders an SVG
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
