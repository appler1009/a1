import { describe, it, expect } from 'vitest';
import {
  formatToolName,
  parseGoogleDriveSearchResult,
  parseDisplayEmailMarker,
} from '../../lib/chat-utils';

describe('formatToolName', () => {
  it('converts camelCase to space-separated lowercase words', () => {
    expect(formatToolName('gmailSearchMessages')).toBe('gmail search messages');
  });

  it('converts underscores to spaces', () => {
    expect(formatToolName('search_tool')).toBe('search tool');
  });

  it('handles multi-word camelCase with domain prefix', () => {
    expect(formatToolName('googleDriveListFiles')).toBe('google drive list files');
  });

  it('handles all-lowercase single word', () => {
    expect(formatToolName('search')).toBe('search');
  });

  it('handles mixed underscores and camelCase', () => {
    expect(formatToolName('get_User_Profile')).toBe('get user profile');
  });

  it('collapses multiple spaces', () => {
    expect(formatToolName('A_B')).toBe('a b');
  });
});

describe('parseGoogleDriveSearchResult', () => {
  it('returns file info for a valid PDF line', () => {
    const result = parseGoogleDriveSearchResult(
      'Report.pdf (ID: abc123, application/pdf)',
    );
    expect(result).toEqual({
      id: 'abc123',
      name: 'Report.pdf',
      mimeType: 'application/pdf',
      previewUrl: 'https://drive.google.com/file/d/abc123/preview',
    });
  });

  it('returns null when the mime type is not application/pdf', () => {
    const result = parseGoogleDriveSearchResult(
      'Spreadsheet.xlsx (ID: xyz789, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)',
    );
    expect(result).toBeNull();
  });

  it('returns the first PDF when multiple lines are present', () => {
    const input = [
      'Notes.txt (ID: t1, text/plain)',
      'Report.pdf (ID: p1, application/pdf)',
      'Another.pdf (ID: p2, application/pdf)',
    ].join('\n');
    const result = parseGoogleDriveSearchResult(input);
    expect(result?.id).toBe('p1');
  });

  it('returns null for malformed input with no matches', () => {
    expect(parseGoogleDriveSearchResult('no results found')).toBeNull();
    expect(parseGoogleDriveSearchResult('')).toBeNull();
  });
});

describe('parseDisplayEmailMarker', () => {
  it('returns email info for a valid marker with subject', () => {
    const emailData = JSON.stringify({ id: 'email-1', subject: 'Hello World', from: 'a@b.com' });
    const result = parseDisplayEmailMarker(
      `___DISPLAY_EMAIL___${emailData}___END_DISPLAY_EMAIL___`,
    );
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Hello World');
    expect(result?.id).toBe('email-1');
    expect(result?.mimeType).toBe('message/rfc822');
  });

  it('falls back to "Email Thread" when subject is missing but messages array exists', () => {
    const emailData = JSON.stringify({
      id: 'thread-1',
      messages: [{ subject: 'Thread Subject' }],
    });
    const result = parseDisplayEmailMarker(
      `___DISPLAY_EMAIL___${emailData}___END_DISPLAY_EMAIL___`,
    );
    expect(result?.name).toBe('Thread Subject');
  });

  it('falls back to "Email" when no subject or messages', () => {
    const emailData = JSON.stringify({ id: 'email-2' });
    const result = parseDisplayEmailMarker(
      `___DISPLAY_EMAIL___${emailData}___END_DISPLAY_EMAIL___`,
    );
    expect(result?.name).toBe('Email');
  });

  it('returns null when marker is absent', () => {
    expect(parseDisplayEmailMarker('some plain text')).toBeNull();
    expect(parseDisplayEmailMarker('')).toBeNull();
  });

  it('returns null for malformed JSON inside the marker', () => {
    const result = parseDisplayEmailMarker(
      '___DISPLAY_EMAIL___not-valid-json___END_DISPLAY_EMAIL___',
    );
    expect(result).toBeNull();
  });
});
