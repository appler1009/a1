/**
 * Unit tests for SmtpImapInProcess — the in-process MCP module.
 *
 * Tests focus on the pure, deterministic behaviour: tool definitions,
 * system prompts, and delegation to the smtp-imap-mcp-lib functions.
 * Library functions are mocked so no real network connections are made.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — registered before the module under test is imported
// ---------------------------------------------------------------------------

const smtpSendEmailMock = mock(async () => ({ content: [{ type: 'text', text: '{"messageId":"abc"}' }] }));
const smtpTestConnectionMock = mock(async () => ({ content: [{ type: 'text', text: '{"success":true}' }] }));
const imapTestConnectionMock = mock(async () => ({ content: [{ type: 'text', text: '{"success":true}' }] }));
const imapListFoldersMock = mock(async () => ({ content: [{ type: 'text', text: '[]' }] }));
const imapListMessagesMock = mock(async () => ({ content: [{ type: 'text', text: '[]' }] }));
const imapGetMessageMock = mock(async () => ({ content: [{ type: 'text', text: '{}' }] }));
const imapSearchMessagesMock = mock(async () => ({ content: [{ type: 'text', text: '[]' }] }));

mock.module('smtp-imap-mcp-lib', () => ({
  CredentialResolver: class {
    constructor(_opts: unknown) {}
    resolve(_input: unknown, _type: string) { return {}; }
  },
  smtpSendEmail: smtpSendEmailMock,
  smtpTestConnection: smtpTestConnectionMock,
  imapTestConnection: imapTestConnectionMock,
  imapListFolders: imapListFoldersMock,
  imapListMessages: imapListMessagesMock,
  imapGetMessage: imapGetMessageMock,
  imapSearchMessages: imapSearchMessagesMock,
}));

const { SmtpImapInProcess } = await import('../mcp/in-process/smtp-imap.js');

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const creds = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecure: true,
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapSecure: true,
  username: 'alice@example.com',
  password: 'secret',
};

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

describe('SmtpImapInProcess — system prompts', () => {
  it('getSystemPromptSummary includes the account username', () => {
    const mod = new SmtpImapInProcess(creds);
    expect(mod.getSystemPromptSummary()).toContain('alice@example.com');
  });

  it('getSystemPrompt includes the account username', () => {
    const mod = new SmtpImapInProcess(creds);
    expect(mod.getSystemPrompt()).toContain('alice@example.com');
  });

  it('getSystemPrompt mentions both SMTP and IMAP', () => {
    const mod = new SmtpImapInProcess(creds);
    const prompt = mod.getSystemPrompt();
    expect(prompt).toContain('SMTP');
    expect(prompt).toContain('IMAP');
  });
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('SmtpImapInProcess — getTools()', () => {
  it('returns exactly 7 tools', async () => {
    const mod = new SmtpImapInProcess(creds);
    const tools = await mod.getTools();
    expect(tools).toHaveLength(7);
  });

  it('exposes all expected tool names', async () => {
    const mod = new SmtpImapInProcess(creds);
    const tools = await mod.getTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('smtpSendEmail');
    expect(names).toContain('smtpTestConnection');
    expect(names).toContain('imapTestConnection');
    expect(names).toContain('imapListFolders');
    expect(names).toContain('imapListMessages');
    expect(names).toContain('imapGetMessage');
    expect(names).toContain('imapSearchMessages');
  });

  it('smtpSendEmail requires from, to, and subject', async () => {
    const mod = new SmtpImapInProcess(creds);
    const tools = await mod.getTools();
    const sendTool = tools.find(t => t.name === 'smtpSendEmail')!;
    expect(sendTool.inputSchema.required).toContain('from');
    expect(sendTool.inputSchema.required).toContain('to');
    expect(sendTool.inputSchema.required).toContain('subject');
  });

  it('imapGetMessage requires uid', async () => {
    const mod = new SmtpImapInProcess(creds);
    const tools = await mod.getTools();
    const getTool = tools.find(t => t.name === 'imapGetMessage')!;
    expect(getTool.inputSchema.required).toContain('uid');
  });

  it('every tool has a non-empty description', async () => {
    const mod = new SmtpImapInProcess(creds);
    const tools = await mod.getTools();
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool delegation
// ---------------------------------------------------------------------------

describe('SmtpImapInProcess — tool delegation', () => {
  let mod: InstanceType<typeof SmtpImapInProcess>;

  beforeEach(() => {
    mod = new SmtpImapInProcess(creds);
    smtpSendEmailMock.mockReset();
    smtpTestConnectionMock.mockReset();
    imapTestConnectionMock.mockReset();
    imapListFoldersMock.mockReset();
    imapListMessagesMock.mockReset();
    imapGetMessageMock.mockReset();
    imapSearchMessagesMock.mockReset();
  });

  it('smtpSendEmail delegates to the library function', async () => {
    smtpSendEmailMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    await mod.smtpSendEmail({ from: 'a@b.com', to: 'c@d.com', subject: 'Hi' });
    expect(smtpSendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('smtpTestConnection delegates to the library function', async () => {
    smtpTestConnectionMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    await mod.smtpTestConnection({});
    expect(smtpTestConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('imapTestConnection delegates to the library function', async () => {
    imapTestConnectionMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    await mod.imapTestConnection({});
    expect(imapTestConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('imapListFolders delegates to the library function', async () => {
    imapListFoldersMock.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
    await mod.imapListFolders({});
    expect(imapListFoldersMock).toHaveBeenCalledTimes(1);
  });

  it('imapListMessages delegates to the library function', async () => {
    imapListMessagesMock.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
    await mod.imapListMessages({ mailbox: 'INBOX' });
    expect(imapListMessagesMock).toHaveBeenCalledTimes(1);
  });

  it('imapGetMessage delegates to the library function', async () => {
    imapGetMessageMock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    await mod.imapGetMessage({ uid: 42 });
    expect(imapGetMessageMock).toHaveBeenCalledTimes(1);
  });

  it('imapSearchMessages delegates to the library function', async () => {
    imapSearchMessagesMock.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
    await mod.imapSearchMessages({ subject: 'hello' });
    expect(imapSearchMessagesMock).toHaveBeenCalledTimes(1);
  });
});
