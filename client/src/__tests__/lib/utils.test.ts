import { describe, it, expect } from 'vitest';
import { cn } from '../../lib/utils';

describe('cn', () => {
  it('returns a single class unchanged', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('merges multiple classes', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('handles conditional classes (falsy values skipped)', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
    expect(cn('a', undefined, 'c')).toBe('a c');
    expect(cn('a', null, 'c')).toBe('a c');
  });

  it('handles object syntax', () => {
    expect(cn({ foo: true, bar: false })).toBe('foo');
    expect(cn({ foo: true, bar: true })).toBe('foo bar');
  });

  it('deduplicates conflicting Tailwind classes (last wins)', () => {
    // twMerge ensures last padding wins
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles empty call', () => {
    expect(cn()).toBe('');
  });
});
