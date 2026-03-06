/**
 * Unit tests for FetchUrlInProcess
 *
 * Covers:
 *   - Tool manifest (getTools)
 *   - HTML → markdown conversion (headings, paragraphs, lists, tables, links, code)
 *   - Form extraction and rendering
 *   - JSON response conversion
 *   - Plain text passthrough
 *   - web_fetch_url: status line, redirect URL, error handling
 *   - web_submit_form: GET (query params), POST url-encoded, POST multipart
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { FetchUrlInProcess } from '../mcp/in-process/fetch-url.js';

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function makeFetchResponse(opts: {
  body: string;
  contentType?: string;
  status?: number;
  statusText?: string;
  url?: string;
}): Response {
  const { body, contentType = 'text/html', status = 200, statusText = 'OK', url = 'https://example.com/' } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof mock>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = mock(async () => makeFetchResponse({ body: '' }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// getTools
// ---------------------------------------------------------------------------

describe('getTools', () => {
  it('returns web_fetch_url and web_submit_form', async () => {
    const m = new FetchUrlInProcess();
    const tools = await m.getTools();
    expect(tools.map(t => t.name)).toEqual(['web_fetch_url', 'web_submit_form']);
  });

  it('web_fetch_url schema requires url', async () => {
    const m = new FetchUrlInProcess();
    const tools = await m.getTools();
    const fetchTool = tools.find(t => t.name === 'web_fetch_url')!;
    expect(fetchTool.inputSchema.required).toContain('url');
  });

  it('web_submit_form schema requires url', async () => {
    const m = new FetchUrlInProcess();
    const tools = await m.getTools();
    const submitTool = tools.find(t => t.name === 'web_submit_form')!;
    expect((submitTool.inputSchema as any).required).toContain('url');
  });
});

// ---------------------------------------------------------------------------
// HTML → markdown: structural elements
// ---------------------------------------------------------------------------

describe('web_fetch_url: HTML conversion', () => {
  async function fetchHtml(html: string, url = 'https://example.com/'): Promise<string> {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () => makeFetchResponse({ body: html, url }));
    const result = await m.web_fetch_url({ url });
    return result.text;
  }

  it('includes status line with URL', async () => {
    const text = await fetchHtml('<html><body><p>hi</p></body></html>', 'https://example.com/page');
    expect(text).toMatch(/\*\*200 OK\*\* — https:\/\/example\.com\/page/);
  });

  it('converts h1–h3 to markdown headings', async () => {
    const text = await fetchHtml('<h1>Title</h1><h2>Sub</h2><h3>Sub-sub</h3>');
    expect(text).toContain('# Title');
    expect(text).toContain('## Sub');
    expect(text).toContain('### Sub-sub');
  });

  it('converts paragraphs', async () => {
    const text = await fetchHtml('<p>Hello world</p><p>Second para</p>');
    expect(text).toContain('Hello world');
    expect(text).toContain('Second para');
  });

  it('converts bold and italic inline', async () => {
    const text = await fetchHtml('<p><strong>bold</strong> and <em>italic</em></p>');
    expect(text).toContain('**bold**');
    expect(text).toContain('*italic*');
  });

  it('converts inline code', async () => {
    const text = await fetchHtml('<p>Use <code>npm install</code> to install</p>');
    expect(text).toContain('`npm install`');
  });

  it('converts pre/code block to fenced block', async () => {
    const text = await fetchHtml('<pre><code>const x = 1;</code></pre>');
    expect(text).toContain('```');
    expect(text).toContain('const x = 1;');
  });

  it('converts unordered list', async () => {
    const text = await fetchHtml('<ul><li>Apple</li><li>Banana</li></ul>');
    expect(text).toContain('- Apple');
    expect(text).toContain('- Banana');
  });

  it('converts ordered list', async () => {
    const text = await fetchHtml('<ol><li>First</li><li>Second</li></ol>');
    expect(text).toContain('1. First');
    expect(text).toContain('2. Second');
  });

  it('converts links', async () => {
    const text = await fetchHtml('<a href="https://example.com">Click here</a>');
    expect(text).toContain('[Click here](https://example.com)');
  });

  it('converts images', async () => {
    const text = await fetchHtml('<img src="photo.jpg" alt="A photo">');
    expect(text).toContain('![A photo](photo.jpg)');
  });

  it('converts a simple table to markdown table', async () => {
    const text = await fetchHtml(
      '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>'
    );
    expect(text).toContain('| Name | Age |');
    expect(text).toContain('| Alice | 30 |');
    expect(text).toContain('| --- | --- |');
  });

  it('strips script and style tags', async () => {
    const text = await fetchHtml(
      '<script>alert("xss")</script><style>.hide{display:none}</style><p>Clean</p>'
    );
    expect(text).not.toContain('alert');
    expect(text).not.toContain('display:none');
    expect(text).toContain('Clean');
  });

  it('converts hr to markdown rule', async () => {
    const text = await fetchHtml('<p>Before</p><hr><p>After</p>');
    expect(text).toContain('---');
  });

  it('converts blockquote', async () => {
    const text = await fetchHtml('<blockquote>Wise words</blockquote>');
    expect(text).toContain('> Wise words');
  });

  it('decodes common HTML entities', async () => {
    const text = await fetchHtml('<p>AT&amp;T &lt;rocks&gt; &quot;yes&quot;</p>');
    expect(text).toContain('AT&T');
    expect(text).toContain('<rocks>');
    expect(text).toContain('"yes"');
  });

  it('prefers <main> content over full body', async () => {
    const text = await fetchHtml(
      '<body><nav>Navigation noise</nav><main><p>Main content</p></main></body>'
    );
    expect(text).toContain('Main content');
    // nav is a separate element but inside body; main is preferred so nav content shouldn't dominate
    expect(text).not.toContain('Navigation noise');
  });
});

// ---------------------------------------------------------------------------
// Form extraction
// ---------------------------------------------------------------------------

describe('web_fetch_url: form extraction', () => {
  async function fetchHtml(html: string): Promise<string> {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({ body: html, url: 'https://example.com/login' })
    );
    return (await m.web_fetch_url({ url: 'https://example.com/login' })).text;
  }

  it('renders form heading with action and method', async () => {
    const text = await fetchHtml(
      '<form action="/auth/login" method="post"><input name="user" type="text"></form>'
    );
    expect(text).toContain('/auth/login');
    expect(text).toContain('POST');
  });

  it('lists text input fields', async () => {
    const text = await fetchHtml(
      '<form action="/login" method="post"><input name="username" type="text" required></form>'
    );
    expect(text).toContain('`username`');
    expect(text).toContain('text');
    expect(text).toContain('required');
  });

  it('lists password fields without default value', async () => {
    const text = await fetchHtml(
      '<form action="/login" method="post"><input name="password" type="password" value="secret"></form>'
    );
    expect(text).toContain('`password`');
    // Password values must not be echoed
    expect(text).not.toContain('secret');
  });

  it('includes select options', async () => {
    const text = await fetchHtml(
      '<form action="/go" method="post"><select name="country"><option value="us">US</option><option value="ca" selected>CA</option></select></form>'
    );
    expect(text).toContain('`country`');
    expect(text).toContain('`us`');
    expect(text).toContain('`ca`');
  });

  it('renders submit button label', async () => {
    const text = await fetchHtml(
      '<form action="/go" method="post"><input type="submit" value="Sign In"></form>'
    );
    expect(text).toContain('Sign In');
  });

  it('includes hidden field names and values', async () => {
    const text = await fetchHtml(
      '<form action="/go" method="post"><input type="hidden" name="_csrf" value="tok123"></form>'
    );
    expect(text).toContain('`_csrf`');
    expect(text).toContain('`tok123`');
  });

  it('handles form with no name using generic heading', async () => {
    const text = await fetchHtml('<form action="/go" method="post"></form>');
    expect(text).toMatch(/###\s*Form/);
  });

  it('uses form name attribute in heading when present', async () => {
    const text = await fetchHtml('<form name="loginForm" action="/go" method="post"></form>');
    expect(text).toContain('loginForm');
  });
});

// ---------------------------------------------------------------------------
// JSON responses
// ---------------------------------------------------------------------------

describe('web_fetch_url: JSON response', () => {
  it('renders JSON in a fenced code block', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({
        body: JSON.stringify({ name: 'Alice', age: 30 }),
        contentType: 'application/json',
        url: 'https://api.example.com/user',
      })
    );
    const result = await m.web_fetch_url({ url: 'https://api.example.com/user' });
    expect(result.text).toContain('```json');
    expect(result.text).toContain('"name": "Alice"');
    expect(result.text).toContain('"age": 30');
  });

  it('handles application/json; charset=utf-8 content type', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({
        body: '{"ok":true}',
        contentType: 'application/json; charset=utf-8',
        url: 'https://api.example.com/',
      })
    );
    const result = await m.web_fetch_url({ url: 'https://api.example.com/' });
    expect(result.text).toContain('```json');
    expect(result.text).toContain('"ok": true');
  });
});

// ---------------------------------------------------------------------------
// Plain text responses
// ---------------------------------------------------------------------------

describe('web_fetch_url: plain text response', () => {
  it('returns text as-is', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({
        body: 'Hello, plain world!',
        contentType: 'text/plain',
        url: 'https://example.com/hello.txt',
      })
    );
    const result = await m.web_fetch_url({ url: 'https://example.com/hello.txt' });
    expect(result.text).toContain('Hello, plain world!');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('web_fetch_url: error handling', () => {
  it('returns error message when fetch throws', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () => { throw new Error('Network failure'); });
    const result = await m.web_fetch_url({ url: 'https://unreachable.example.com/' });
    expect(result.type).toBe('text');
    expect(result.text).toContain('Network failure');
  });
});

// ---------------------------------------------------------------------------
// web_submit_form
// ---------------------------------------------------------------------------

describe('web_submit_form', () => {
  it('sends POST with url-encoded body by default', async () => {
    const m = new FetchUrlInProcess();
    let capturedInit: RequestInit | undefined;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return makeFetchResponse({ body: '<p>OK</p>', url: 'https://example.com/login' });
    });

    await m.web_submit_form({
      url: 'https://example.com/login',
      fields: { username: 'alice', password: 'pw123' },
    });

    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toContain('username=alice');
    expect(capturedInit?.body).toContain('password=pw123');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('sends GET with query params when method is GET', async () => {
    const m = new FetchUrlInProcess();
    let capturedUrl = '';
    fetchMock.mockImplementation(async (url: string) => {
      capturedUrl = url;
      return makeFetchResponse({ body: '<p>OK</p>', url });
    });

    await m.web_submit_form({
      url: 'https://example.com/search',
      method: 'GET',
      fields: { q: 'hello world' },
    });

    expect(capturedUrl).toContain('q=hello+world');
    expect(capturedUrl).toContain('https://example.com/search?');
  });

  it('appends GET params with & when URL already has query string', async () => {
    const m = new FetchUrlInProcess();
    let capturedUrl = '';
    fetchMock.mockImplementation(async (url: string) => {
      capturedUrl = url;
      return makeFetchResponse({ body: '<p>OK</p>', url });
    });

    await m.web_submit_form({
      url: 'https://example.com/search?page=1',
      method: 'GET',
      fields: { q: 'test' },
    });

    expect(capturedUrl).toContain('page=1');
    expect(capturedUrl).toContain('q=test');
    expect(capturedUrl).toContain('&');
  });

  it('sends multipart/form-data when enctype is multipart', async () => {
    const m = new FetchUrlInProcess();
    let capturedInit: RequestInit | undefined;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return makeFetchResponse({ body: '<p>OK</p>', url: 'https://example.com/upload' });
    });

    await m.web_submit_form({
      url: 'https://example.com/upload',
      method: 'POST',
      enctype: 'multipart/form-data',
      fields: { file_name: 'report.pdf' },
    });

    expect(capturedInit?.body).toBeInstanceOf(FormData);
    // Content-Type should NOT be set manually (fetch adds boundary automatically)
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('returns markdown of the response page', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({ body: '<h1>Welcome back</h1>', url: 'https://example.com/dashboard' })
    );

    const result = await m.web_submit_form({
      url: 'https://example.com/login',
      fields: { user: 'alice' },
    });

    expect(result.text).toContain('# Welcome back');
  });

  it('returns error message when fetch throws', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () => { throw new Error('Connection refused'); });
    const result = await m.web_submit_form({ url: 'https://example.com/login' });
    expect(result.type).toBe('text');
    expect(result.text).toContain('Connection refused');
  });

  it('sends empty body when no fields provided', async () => {
    const m = new FetchUrlInProcess();
    let capturedInit: RequestInit | undefined;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return makeFetchResponse({ body: '<p>OK</p>', url: 'https://example.com/action' });
    });

    await m.web_submit_form({ url: 'https://example.com/action' });

    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toBe('');
  });
});
