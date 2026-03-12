import { describe, it, expect } from 'bun:test';
import { buildRoleDescription } from '../routes/messages.js';

describe('buildRoleDescription', () => {
  it('prepends role description to the system prompt', () => {
    const result = buildRoleDescription('Support', 'Help users with billing questions.');
    expect(result).toBe('You are an AI assistant for the role "Support" with this description:\n```\nHelp users with billing questions.\n```\n\n');
  });

  it('includes the role name in the output', () => {
    const result = buildRoleDescription('Strata Council', 'Manage a 40-unit building.');
    expect(result).toContain('"Strata Council"');
  });

  it('includes the job description in the output', () => {
    const jobDesc = 'Handle resident complaints and meeting agendas.';
    const result = buildRoleDescription('President', jobDesc);
    expect(result).toContain(jobDesc);
  });

  it('ends with a double newline so it separates cleanly from the rest of the system prompt', () => {
    const result = buildRoleDescription('Teacher', 'Prepare lesson plans.');
    expect(result.endsWith('\n\n')).toBe(true);
  });
});
