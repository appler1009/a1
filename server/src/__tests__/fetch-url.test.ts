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
 *   - SSRF protection: blocked private/reserved IPs, localhost, bad protocols,
 *                      DNS-resolved private IPs, redirect-to-private-IP
 *   - Response size limit: Content-Length header, streaming body
 *   - Hidden-content stripping: display:none, visibility:hidden, hidden attribute
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock dns/promises before the module under test loads it
// ---------------------------------------------------------------------------

// Default: resolve any hostname to a safe public IP
const dnsLookupMock = mock(async (_hostname: string, _opts: any) => [
  { address: '93.184.216.34', family: 4 },
]);
mock.module('dns/promises', () => ({ lookup: dnsLookupMock }));

// Dynamic import so the mock above is already in place when fetch-url.ts loads
const { FetchUrlInProcess, _requestTimestamps } = await import('../mcp/in-process/fetch-url.js');

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function makeFetchResponse(opts: {
  body: string;
  contentType?: string;
  status?: number;
  statusText?: string;
  url?: string;
  headers?: Record<string, string>;
}): Response {
  const {
    body,
    contentType = 'text/html',
    status = 200,
    statusText = 'OK',
    url = 'https://example.com/',
    headers: extraHeaders = {},
  } = opts;

  const allHeaders: Record<string, string> = {
    'content-type': contentType,
    ...extraHeaders,
  };

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url,
    headers: { get: (h: string) => allHeaders[h.toLowerCase()] ?? null },
    body: null, // use .text() by default
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

/** A redirect response (manual mode returns 3xx as-is) */
function makeRedirectResponse(location: string, status = 302): Response {
  return {
    ok: false,
    status,
    statusText: 'Found',
    url: 'https://example.com/redirect',
    headers: { get: (h: string) => h.toLowerCase() === 'location' ? location : null },
    body: null,
    text: async () => '',
  } as unknown as Response;
}

/** A response whose body is a ReadableStream of `totalBytes` bytes */
function makeLargeStreamResponse(totalBytes: number): Response {
  const chunkSize = 4096;
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) { controller.close(); return; }
      const size = Math.min(chunkSize, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(65)); // 'A'
      sent += size;
    },
  });
  return {
    ok: true, status: 200, statusText: 'OK',
    url: 'https://example.com/big',
    headers: { get: (h: string) => h.toLowerCase() === 'content-type' ? 'text/plain' : null },
    body: stream,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof mock>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = mock(async () => makeFetchResponse({ body: '' }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Reset DNS mock to safe default before each test
  dnsLookupMock.mockImplementation(async () => [{ address: '93.184.216.34', family: 4 }]);
  // Reset rate-limit state so tests don't bleed into each other
  _requestTimestamps.length = 0;
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
    expect(tools.find(t => t.name === 'web_fetch_url')!.inputSchema.required).toContain('url');
  });

  it('web_submit_form schema requires url', async () => {
    const m = new FetchUrlInProcess();
    const tools = await m.getTools();
    expect((tools.find(t => t.name === 'web_submit_form')!.inputSchema as any).required).toContain('url');
  });
});

// ---------------------------------------------------------------------------
// HTML → markdown: structural elements
// ---------------------------------------------------------------------------

describe('web_fetch_url: HTML conversion', () => {
  async function fetchHtml(html: string, url = 'https://example.com/'): Promise<string> {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () => makeFetchResponse({ body: html, url }));
    return (await m.web_fetch_url({ url })).text;
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
    expect(text).not.toContain('Navigation noise');
  });
});

// ---------------------------------------------------------------------------
// Hidden-content stripping (prompt-injection mitigation)
// ---------------------------------------------------------------------------

describe('web_fetch_url: hidden content stripping', () => {
  async function fetchHtml(html: string): Promise<string> {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () => makeFetchResponse({ body: html, url: 'https://example.com/' }));
    return (await m.web_fetch_url({ url: 'https://example.com/' })).text;
  }

  it('strips elements with display:none style', async () => {
    const text = await fetchHtml(
      '<p>Visible</p><div style="display:none">Hidden injection</div>'
    );
    expect(text).toContain('Visible');
    expect(text).not.toContain('Hidden injection');
  });

  it('strips elements with visibility:hidden style', async () => {
    const text = await fetchHtml(
      '<p>Visible</p><span style="visibility:hidden">Invisible text</span>'
    );
    expect(text).toContain('Visible');
    expect(text).not.toContain('Invisible text');
  });

  it('strips elements with the hidden attribute', async () => {
    const text = await fetchHtml(
      '<p>Visible</p><p hidden>Secret instructions</p>'
    );
    expect(text).toContain('Visible');
    expect(text).not.toContain('Secret instructions');
  });

  it('strips nested hidden elements', async () => {
    const text = await fetchHtml(
      '<div style="display:none"><p>Outer hidden</p><span>Inner also hidden</span></div><p>Real</p>'
    );
    expect(text).toContain('Real');
    expect(text).not.toContain('Outer hidden');
    expect(text).not.toContain('Inner also hidden');
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
// SSRF protection
// ---------------------------------------------------------------------------

describe('SSRF protection', () => {
  async function expectBlocked(url: string): Promise<void> {
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url });
    expect(result.type).toBe('text');
    expect(result.text).toMatch(/Error fetching URL|Blocked|Protocol not allowed|Invalid URL|DNS/i);
    // fetch must never have been called
    expect(fetchMock).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('blocks AWS metadata endpoint (169.254.169.254)', async () => {
    await expectBlocked('http://169.254.169.254/latest/meta-data/');
  });

  it('blocks loopback 127.0.0.1', async () => {
    await expectBlocked('http://127.0.0.1/');
  });

  it('blocks private 10.x.x.x', async () => {
    await expectBlocked('http://10.0.0.1/internal');
  });

  it('blocks private 172.16.x.x', async () => {
    await expectBlocked('http://172.16.1.1/');
  });

  it('blocks private 192.168.x.x', async () => {
    await expectBlocked('http://192.168.1.1/');
  });

  it('blocks localhost hostname', async () => {
    await expectBlocked('http://localhost/');
  });

  it('blocks IPv6 loopback ::1', async () => {
    await expectBlocked('http://[::1]/');
  });

  it('blocks file:// protocol', async () => {
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'file:///etc/passwd' });
    expect(result.text).toContain('Error fetching URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks ftp:// protocol', async () => {
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'ftp://example.com/file' });
    expect(result.text).toContain('Error fetching URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks when DNS resolves hostname to a private IP', async () => {
    dnsLookupMock.mockImplementation(async () => [{ address: '10.0.0.5', family: 4 }]);
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'http://internal.corp/' });
    expect(result.text).toContain('Error fetching URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks when DNS resolves hostname to link-local IP', async () => {
    dnsLookupMock.mockImplementation(async () => [{ address: '169.254.1.1', family: 4 }]);
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'http://sneaky.attacker.com/' });
    expect(result.text).toContain('Error fetching URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks redirect to private IP', async () => {
    // First call returns a redirect to the metadata service
    fetchMock.mockImplementationOnce(async () =>
      makeRedirectResponse('http://169.254.169.254/latest/meta-data/')
    );
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'https://example.com/redirect' });
    expect(result.text).toContain('Error fetching URL');
    // fetch was called once (the initial request) but not a second time (the redirect was blocked)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks redirect to loopback', async () => {
    fetchMock.mockImplementationOnce(async () =>
      makeRedirectResponse('http://127.0.0.1:8080/admin')
    );
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'https://example.com/go' });
    expect(result.text).toContain('Error fetching URL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows public HTTPS URLs', async () => {
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({ body: '<p>OK</p>', url: 'https://example.com/' })
    );
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'https://example.com/' });
    expect(result.text).toContain('OK');
  });

  it('also blocks SSRF in web_submit_form', async () => {
    const m = new FetchUrlInProcess();
    const result = await m.web_submit_form({
      url: 'http://169.254.169.254/latest/meta-data/',
      fields: {},
    });
    expect(result.text).toContain('Error submitting form');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // IPv4 alternate notation — the WHATWG URL parser normalises all of these to
  // dotted-decimal before our regex/range check ever sees them.
  it('blocks hex IPv4 (0x7f000001 → 127.0.0.1)', async () => {
    await expectBlocked('http://0x7f000001/');
  });

  it('blocks decimal-integer IPv4 (2130706433 → 127.0.0.1)', async () => {
    await expectBlocked('http://2130706433/');
  });

  it('blocks octal IPv4 (0177.0.0.1 → 127.0.0.1)', async () => {
    await expectBlocked('http://0177.0.0.1/');
  });
});

// ---------------------------------------------------------------------------
// DNS timeout
// ---------------------------------------------------------------------------

describe('DNS timeout', () => {
  it('returns error when DNS lookup hangs beyond 5 s', async () => {
    // Make DNS never resolve
    dnsLookupMock.mockImplementation(() => new Promise(() => {}));
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'http://slow-dns.example.com/' });
    expect(result.type).toBe('text');
    expect(result.text).toMatch(/DNS.*timed out|DNS resolution failed/i);
    expect(fetchMock).not.toHaveBeenCalled();
  }, 10_000);
});

// ---------------------------------------------------------------------------
// HTTPS → HTTP downgrade
// ---------------------------------------------------------------------------

describe('HTTPS → HTTP redirect block', () => {
  it('blocks redirect from HTTPS to HTTP', async () => {
    fetchMock.mockImplementationOnce(async () =>
      makeRedirectResponse('http://example.com/insecure', 301)
    );
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'https://example.com/page' });
    expect(result.text).toContain('Error fetching URL');
    expect(result.text).toMatch(/HTTPS to HTTP/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows HTTPS → HTTPS redirect', async () => {
    fetchMock
      .mockImplementationOnce(async () => makeRedirectResponse('https://example.com/new', 301))
      .mockImplementationOnce(async () => makeFetchResponse({ body: '<p>OK</p>', url: 'https://example.com/new' }));
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'https://example.com/old' });
    expect(result.text).toContain('OK');
  });

  it('allows HTTP → HTTP redirect', async () => {
    fetchMock
      .mockImplementationOnce(async () => makeRedirectResponse('http://example.com/new', 302))
      .mockImplementationOnce(async () => makeFetchResponse({ body: '<p>OK</p>', url: 'http://example.com/new' }));
    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'http://example.com/old' });
    expect(result.text).toContain('OK');
  });
});

// ---------------------------------------------------------------------------
// Header sanitisation
// ---------------------------------------------------------------------------

describe('Header sanitisation', () => {
  async function captureHeaders(userHeaders: Record<string, string>): Promise<Record<string, string>> {
    let captured: Record<string, string> = {};
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      captured = (init?.headers ?? {}) as Record<string, string>;
      return makeFetchResponse({ body: '<p>ok</p>', url: 'https://example.com/' });
    });
    const m = new FetchUrlInProcess();
    await m.web_fetch_url({ url: 'https://example.com/', headers: userHeaders });
    return captured;
  }

  it('strips Cookie header', async () => {
    const h = await captureHeaders({ Cookie: 'session=abc' });
    expect(h['Cookie']).toBeUndefined();
    expect(h['cookie']).toBeUndefined();
  });

  it('strips Authorization header', async () => {
    const h = await captureHeaders({ Authorization: 'Bearer token' });
    expect(h['Authorization']).toBeUndefined();
    expect(h['authorization']).toBeUndefined();
  });

  it('strips Host header', async () => {
    const h = await captureHeaders({ Host: 'internal.corp' });
    expect(h['Host']).toBeUndefined();
    expect(h['host']).toBeUndefined();
  });

  it('strips X-Forwarded-For header', async () => {
    const h = await captureHeaders({ 'X-Forwarded-For': '127.0.0.1' });
    expect(h['X-Forwarded-For']).toBeUndefined();
    expect(h['x-forwarded-for']).toBeUndefined();
  });

  it('allows safe custom headers through', async () => {
    const h = await captureHeaders({ 'X-Custom-Token': 'abc123', 'Accept-Language': 'en' });
    expect(h['X-Custom-Token']).toBe('abc123');
    expect(h['Accept-Language']).toBe('en');
  });

  it('preserves default User-Agent when not overridden', async () => {
    const h = await captureHeaders({});
    expect(h['User-Agent']).toContain('assist1.me');
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('Rate limiting', () => {
  it('blocks requests beyond 60 per minute', async () => {
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({ body: '<p>ok</p>', url: 'https://example.com/' })
    );

    // Fill the window with 60 fake recent timestamps
    const now = Date.now();
    for (let i = 0; i < 60; i++) _requestTimestamps.push(now - i * 100);

    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'https://example.com/' });
    expect(result.text).toContain('Error fetching URL');
    expect(result.text).toMatch(/Rate limit/i);
  });

  it('allows requests once old entries expire from the window', async () => {
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({ body: '<p>ok</p>', url: 'https://example.com/' })
    );

    // Fill with 60 timestamps that are 2 minutes old (outside the window)
    const old = Date.now() - 120_000;
    for (let i = 0; i < 60; i++) _requestTimestamps.push(old + i * 100);

    const m = new FetchUrlInProcess();
    const result = await m.web_fetch_url({ url: 'https://example.com/' });
    expect(result.text).not.toMatch(/Rate limit/i);
  });
});

// ---------------------------------------------------------------------------
// Response size limit
// ---------------------------------------------------------------------------

describe('Response size limit', () => {
  it('blocks response when Content-Length exceeds 5 MB', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({
        body: 'data',
        contentType: 'text/plain',
        headers: { 'content-length': String(6 * 1024 * 1024) }, // 6 MB
        url: 'https://example.com/big',
      })
    );
    const result = await m.web_fetch_url({ url: 'https://example.com/big' });
    expect(result.text).toContain('Error fetching URL');
    expect(result.text).toMatch(/too large/i);
  });

  it('allows response within 5 MB Content-Length', async () => {
    const m = new FetchUrlInProcess();
    fetchMock.mockImplementation(async () =>
      makeFetchResponse({
        body: 'small',
        contentType: 'text/plain',
        headers: { 'content-length': String(1024) },
        url: 'https://example.com/small',
      })
    );
    const result = await m.web_fetch_url({ url: 'https://example.com/small' });
    expect(result.text).toContain('small');
  });

  it('blocks response when streamed body exceeds 5 MB', async () => {
    const m = new FetchUrlInProcess();
    const SIX_MB = 6 * 1024 * 1024;
    fetchMock.mockImplementation(async () => makeLargeStreamResponse(SIX_MB));
    const result = await m.web_fetch_url({ url: 'https://example.com/stream' });
    expect(result.text).toContain('Error fetching URL');
    expect(result.text).toMatch(/too large/i);
  });

  it('allows streamed body within 5 MB', async () => {
    const m = new FetchUrlInProcess();
    const ONE_KB = 1024;
    fetchMock.mockImplementation(async () => makeLargeStreamResponse(ONE_KB));
    const result = await m.web_fetch_url({ url: 'https://example.com/stream' });
    // Should succeed — content is plain text 'A' * 1024
    expect(result.text).not.toMatch(/too large/i);
    expect(result.text).not.toContain('Error fetching URL');
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
