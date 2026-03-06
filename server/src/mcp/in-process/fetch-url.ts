/**
 * Fetch URL In-Process MCP Module
 *
 * Fetches URLs and converts responses (HTML, JSON, plain text) to markdown.
 * HTML forms are extracted and rendered so the LLM can submit them.
 *
 * Tools:
 *   web_fetch_url  — HTTP GET a URL → markdown
 *   web_submit_form — Submit form data (GET or POST) → markdown
 */

import { lookup as dnsLookup } from 'dns/promises';
import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import { parse as parseHtml, type HTMLElement, type Node } from 'node-html-parser';

// ---------------------------------------------------------------------------
// Security: SSRF protection
// ---------------------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 10;
const DNS_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Security: Rate limiting
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 60;           // max requests
const RATE_LIMIT_WINDOW_MS = 60_000; // per minute (sliding window)
export const _requestTimestamps: number[] = [];

function checkRateLimit(): void {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  // evict entries outside the window
  while (_requestTimestamps.length > 0 && _requestTimestamps[0] < cutoff) {
    _requestTimestamps.shift();
  }
  if (_requestTimestamps.length >= RATE_LIMIT_MAX) {
    throw new Error(`Rate limit exceeded: max ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s`);
  }
  _requestTimestamps.push(now);
}

// ---------------------------------------------------------------------------
// Security: Header sanitization
// ---------------------------------------------------------------------------

// Headers users must not be able to set — would allow session riding, spoofing,
// or bypassing server-side request validation.
const BLOCKED_USER_HEADERS = new Set([
  'cookie',
  'authorization',
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]);

function sanitizeUserHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!BLOCKED_USER_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const BLOCKED_IPV4: Array<{ base: number; mask: number }> = [
  { base: ipv4ToNumber('0.0.0.0'),        mask: 0xff000000 }, // 0.0.0.0/8        this-network
  { base: ipv4ToNumber('10.0.0.0'),       mask: 0xff000000 }, // 10.0.0.0/8       private
  { base: ipv4ToNumber('100.64.0.0'),     mask: 0xffc00000 }, // 100.64.0.0/10    shared (RFC 6598)
  { base: ipv4ToNumber('127.0.0.0'),      mask: 0xff000000 }, // 127.0.0.0/8      loopback
  { base: ipv4ToNumber('169.254.0.0'),    mask: 0xffff0000 }, // 169.254.0.0/16   link-local / AWS metadata
  { base: ipv4ToNumber('172.16.0.0'),     mask: 0xfff00000 }, // 172.16.0.0/12    private
  { base: ipv4ToNumber('192.0.0.0'),      mask: 0xffffff00 }, // 192.0.0.0/24     IETF protocol
  { base: ipv4ToNumber('192.168.0.0'),    mask: 0xffff0000 }, // 192.168.0.0/16   private
  { base: ipv4ToNumber('198.18.0.0'),     mask: 0xfffe0000 }, // 198.18.0.0/15    benchmarking
  { base: ipv4ToNumber('198.51.100.0'),   mask: 0xffffff00 }, // 198.51.100.0/24  documentation
  { base: ipv4ToNumber('203.0.113.0'),    mask: 0xffffff00 }, // 203.0.113.0/24   documentation
  { base: ipv4ToNumber('240.0.0.0'),      mask: 0xf0000000 }, // 240.0.0.0/4      reserved
  { base: ipv4ToNumber('255.255.255.255'), mask: 0xffffffff }, // broadcast
];

function isBlockedIPv4(ip: string): boolean {
  try {
    const n = ipv4ToNumber(ip);
    // Apply >>> 0 to masked value: JS & returns signed 32-bit, which won't ===
    // the unsigned base for any IP with bit 31 set (≥128.x, incl 169.254, 172.16, 192.168).
    return BLOCKED_IPV4.some(({ base, mask }) => ((n & mask) >>> 0) === base);
  } catch {
    return true;
  }
}

function isBlockedIPv6(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;  // loopback
  if (ip === '::' || ip === '0:0:0:0:0:0:0:0') return true;   // unspecified
  if (/^f[cd]/i.test(ip)) return true;                         // fc00::/7 unique-local
  if (/^fe[89ab]/i.test(ip)) return true;                      // fe80::/10 link-local
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

async function assertSafeUrl(urlStr: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(urlStr); } catch { throw new Error(`Invalid URL: ${urlStr}`); }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Protocol not allowed: ${parsed.protocol}. Only http and https are permitted.`);
  }

  const { hostname } = parsed;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (isBlockedIPv4(hostname)) throw new Error(`Blocked: ${hostname} is a private or reserved IPv4 address`);
    return;
  }
  if (hostname === 'localhost') throw new Error(`Blocked: localhost is not allowed`);
  if (hostname.startsWith('[') || /^[0-9a-f:]+$/i.test(hostname)) {
    if (isBlockedIPv6(hostname)) throw new Error(`Blocked: ${hostname} is a private or reserved IPv6 address`);
    return;
  }

  // DNS rebinding note: there is an inherent race between our lookup and the
  // actual TCP connection made by fetch(). A sophisticated attacker who controls
  // DNS could flip the record between the two calls. The architectural mitigation
  // is IMDSv2 (HttpTokens=required on the ECS task), which rejects unauthenticated
  // metadata requests even if the connection reaches 169.254.169.254. A code-level
  // fix would require replacing fetch() with a custom socket that re-validates the
  // connected IP — not implemented here due to TLS complexity.
  let records: { address: string; family: number }[];
  try {
    records = await Promise.race([
      dnsLookup(hostname, { all: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`DNS lookup timed out for ${hostname}`)), DNS_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    throw new Error(`DNS resolution failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const { address, family } of records) {
    if (family === 4 && isBlockedIPv4(address)) throw new Error(`Blocked: ${hostname} resolves to private IPv4 ${address}`);
    if (family === 6 && isBlockedIPv6(address)) throw new Error(`Blocked: ${hostname} resolves to private IPv6 ${address}`);
  }
}

async function safeFetch(urlStr: string, init: RequestInit & { signal?: AbortSignal }): Promise<Response> {
  checkRateLimit();
  await assertSafeUrl(urlStr);
  let currentUrl = urlStr;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };
  let redirectsLeft = MAX_REDIRECTS;
  while (true) {
    const response = await fetch(currentUrl, currentInit);
    const { status } = response;
    if (status < 300 || status >= 400) return response;
    if (redirectsLeft-- <= 0) throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect response missing Location header');
    const nextUrl = new URL(location, currentUrl).toString();
    // Block protocol downgrade: HTTPS → HTTP leaks data and bypasses TLS
    if (new URL(currentUrl).protocol === 'https:' && new URL(nextUrl).protocol === 'http:') {
      throw new Error(`Blocked: HTTPS to HTTP redirect is not permitted`);
    }
    await assertSafeUrl(nextUrl);
    currentUrl = nextUrl;
    if ([301, 302, 303].includes(status) && (currentInit as any).method !== 'GET') {
      const { body: _b, ...rest } = currentInit as any;
      currentInit = { ...rest, method: 'GET', body: undefined };
    }
  }
}

// ---------------------------------------------------------------------------
// Security: Response size limit + timeout
// ---------------------------------------------------------------------------

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const REQUEST_TIMEOUT_MS = 30_000;

async function readBodyWithLimit(response: Response): Promise<string> {
  const cl = response.headers.get('content-length');
  if (cl) {
    const bytes = parseInt(cl, 10);
    if (!isNaN(bytes) && bytes > MAX_RESPONSE_BYTES)
      throw new Error(`Response too large: Content-Length ${bytes} bytes exceeds ${MAX_RESPONSE_BYTES}-byte limit`);
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`Response too large: exceeded ${MAX_RESPONSE_BYTES}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

// ---------------------------------------------------------------------------
// HTML → Markdown converter
// ---------------------------------------------------------------------------

/**
 * Inline tags that should not introduce newlines
 */
const INLINE_TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 'code', 'span', 'label', 'abbr', 'cite', 'small', 'sup', 'sub', 's', 'del', 'ins', 'u', 'time', 'mark']);

/**
 * Tags whose content we fully discard
 */
const DROP_TAGS = new Set(['script', 'style', 'noscript', 'head', 'meta', 'link', 'svg', 'canvas', 'iframe', 'embed', 'object']);

// ---------------------------------------------------------------------------
// Shared HTTP configuration
// ----------------------------------------------------------------------------

/** Default headers for web fetch requests */
const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (compatible; assist1.me/1.0)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
};

/**
 * Build request headers by merging default headers with user-provided headers
 */
function buildRequestHeaders(userHeaders?: Record<string, string>): Record<string, string> {
  return {
    ...DEFAULT_REQUEST_HEADERS,
    // Strip sensitive headers before merging so the LLM can't ride sessions
    // or spoof internal routing headers.
    ...sanitizeUserHeaders(userHeaders ?? {}),
  };
}

/**
 * Return true if the element is visually hidden — common prompt-injection vector.
 */
function isHidden(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return true;
  const style = el.getAttribute('style') ?? '';
  if (/display\s*:\s*none/i.test(style)) return true;
  if (/visibility\s*:\s*hidden/i.test(style)) return true;
  return false;
}

/**
 * Render an HTML node tree to markdown text
 */
function renderNode(node: Node, indent = 0): string {
  // Text node
  if (node.nodeType === 3) {
    return (node as any).rawText ?? '';
  }

  if (node.nodeType !== 1) return '';

  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase() ?? '';

  if (DROP_TAGS.has(tag)) return '';

  // Navigation / chrome we can skip
  if (tag === 'nav' || tag === 'footer' || tag === 'aside') return '';

  // Security: drop visually hidden elements to reduce prompt-injection surface
  if (isHidden(el)) return '';

  const children = () => el.childNodes.map(c => renderNode(c, indent)).join('');
  const childrenTrimmed = () => children().trim();

  switch (tag) {
    case 'h1': return `\n# ${childrenTrimmed()}\n\n`;
    case 'h2': return `\n## ${childrenTrimmed()}\n\n`;
    case 'h3': return `\n### ${childrenTrimmed()}\n\n`;
    case 'h4': return `\n#### ${childrenTrimmed()}\n\n`;
    case 'h5': return `\n##### ${childrenTrimmed()}\n\n`;
    case 'h6': return `\n###### ${childrenTrimmed()}\n\n`;

    case 'p': {
      const text = childrenTrimmed();
      return text ? `\n${text}\n\n` : '';
    }

    case 'br': return '\n';

    case 'hr': return '\n---\n\n';

    case 'strong':
    case 'b': {
      const text = childrenTrimmed();
      return text ? `**${text}**` : '';
    }

    case 'em':
    case 'i': {
      const text = childrenTrimmed();
      return text ? `*${text}*` : '';
    }

    case 'code': {
      const text = childrenTrimmed();
      return text ? `\`${text}\`` : '';
    }

    case 'pre': {
      const inner = el.querySelector('code');
      const lang = inner?.getAttribute('class')?.match(/language-(\w+)/)?.[1] ?? '';
      const text = (inner ?? el).innerText ?? '';
      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }

    case 'blockquote': {
      const text = childrenTrimmed();
      return text.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
    }

    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const text = childrenTrimmed();
      if (!text && !href) return '';
      if (!text) return href;
      if (!href) return text;
      return `[${text}](${href})`;
    }

    case 'img': {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      return src ? `![${alt}](${src})` : '';
    }

    case 'ul': {
      const items = el.querySelectorAll(':scope > li').map(li => {
        const content = renderNode(li, indent + 2).trim();
        return `${'  '.repeat(indent)}- ${content}`;
      });
      return items.length ? `\n${items.join('\n')}\n\n` : '';
    }

    case 'ol': {
      const items = el.querySelectorAll(':scope > li').map((li, i) => {
        const content = renderNode(li, indent + 3).trim();
        return `${'  '.repeat(indent)}${i + 1}. ${content}`;
      });
      return items.length ? `\n${items.join('\n')}\n\n` : '';
    }

    case 'li': return children();

    case 'table': return renderTable(el);

    case 'form': return renderForm(el);

    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'header': {
      const text = children();
      // Avoid double-blank-lines inside block containers
      return text;
    }

    default:
      // Inline elements: just render children inline
      if (INLINE_TAGS.has(tag)) return children();
      // Unknown block-level elements
      return children();
  }
}

function renderTable(table: HTMLElement): string {
  const rows = table.querySelectorAll('tr');
  if (!rows.length) return '';

  const grid: string[][] = rows.map(row =>
    row.querySelectorAll('th, td').map(cell => renderNode(cell).trim().replace(/\n+/g, ' '))
  );

  if (!grid[0].length) return '';

  const colCount = Math.max(...grid.map(r => r.length));
  // Pad rows
  const padded = grid.map(r => {
    while (r.length < colCount) r.push('');
    return r;
  });

  const header = padded[0];
  const separator = header.map(() => '---');
  const body = padded.slice(1);

  const fmt = (row: string[]) => `| ${row.join(' | ')} |`;

  const lines = [fmt(header), fmt(separator), ...body.map(fmt)];
  return `\n${lines.join('\n')}\n\n`;
}

function renderForm(form: HTMLElement): string {
  const action = form.getAttribute('action') ?? '';
  const method = (form.getAttribute('method') ?? 'GET').toUpperCase();
  const name = form.getAttribute('name') ?? form.getAttribute('id') ?? '';
  const enctype = form.getAttribute('enctype') ?? 'application/x-www-form-urlencoded';

  const heading = name ? `Form: ${name}` : 'Form';
  const lines: string[] = [
    `\n### ${heading}`,
    `- **Action**: \`${action || '(current URL)'}\``,
    `- **Method**: ${method}`,
  ];

  if (enctype !== 'application/x-www-form-urlencoded') {
    lines.push(`- **Encoding**: ${enctype}`);
  }

  // Collect all input/select/textarea elements
  const inputs = form.querySelectorAll('input, select, textarea, button[type="submit"]');
  if (inputs.length) {
    lines.push('- **Fields**:');

    for (const el of inputs) {
      const inputType = (el.getAttribute('type') ?? (el.tagName.toLowerCase() === 'textarea' ? 'textarea' : el.tagName.toLowerCase() === 'select' ? 'select' : 'text')).toLowerCase();
      if (inputType === 'hidden') {
        const n = el.getAttribute('name') ?? '';
        const v = el.getAttribute('value') ?? '';
        lines.push(`  - \`${n}\` (hidden): \`${v}\``);
        continue;
      }
      if (inputType === 'submit' || inputType === 'button') {
        const label = el.getAttribute('value') ?? el.innerText.trim() ?? 'Submit';
        lines.push(`  - **[Submit: ${label}]**`);
        continue;
      }

      const fieldName = el.getAttribute('name') ?? '';
      const required = el.hasAttribute('required') ? ' *(required)*' : '';
      const placeholder = el.getAttribute('placeholder') ?? '';
      const defaultVal = el.getAttribute('value') ?? (el.tagName.toLowerCase() === 'textarea' ? el.innerText.trim() : '');

      let fieldDesc = `  - \`${fieldName}\` (${inputType})${required}`;
      if (placeholder) fieldDesc += ` — ${placeholder}`;
      if (defaultVal && inputType !== 'password') fieldDesc += ` [default: \`${defaultVal}\`]`;

      if (inputType === 'select') {
        const options = el.querySelectorAll('option').map(opt => {
          const val = opt.getAttribute('value') ?? opt.innerText.trim();
          const sel = opt.hasAttribute('selected') ? ' ✓' : '';
          return `\`${val}\`${sel}`;
        });
        if (options.length) fieldDesc += ` — options: ${options.join(', ')}`;
      }

      if (inputType === 'radio' || inputType === 'checkbox') {
        const val = el.getAttribute('value') ?? 'on';
        const checked = el.hasAttribute('checked') ? ' *(checked)*' : '';
        fieldDesc = `  - \`${fieldName}\` (${inputType}) value=\`${val}\`${checked}${required}`;
      }

      lines.push(fieldDesc);
    }
  }

  lines.push('');
  return lines.join('\n') + '\n';
}

/**
 * Convert HTML string to markdown
 */
function htmlToMarkdown(html: string): string {
  const root = parseHtml(html, {
    lowerCaseTagName: true,
    comment: false,
    fixNestedATags: true,
  });

  // Try to extract meaningful content: prefer <main>, <article>, <body>
  const body = root.querySelector('main') ?? root.querySelector('article') ?? root.querySelector('body') ?? root;

  let md = renderNode(body);

  // Collapse 3+ consecutive blank lines to 2
  md = md.replace(/\n{3,}/g, '\n\n');

  // Decode common HTML entities
  md = decodeEntities(md);

  return md.trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»');
}

/**
 * Convert JSON to a readable markdown code block
 */
function jsonToMarkdown(data: unknown): string {
  return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Response processor
// ---------------------------------------------------------------------------

async function processResponse(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const finalUrl = response.url;
  const statusLine = `**${response.status} ${response.statusText}** — ${finalUrl}\n\n`;

  const rawText = await readBodyWithLimit(response);

  if (contentType.includes('application/json') || contentType.includes('+json')) {
    let data: unknown;
    try { data = JSON.parse(rawText); } catch { data = rawText; }
    return statusLine + jsonToMarkdown(data);
  }

  if (contentType.includes('text/html')) {
    return statusLine + htmlToMarkdown(rawText);
  }

  // Plain text, XML, CSV, etc.
  if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
    return statusLine + `\`\`\`xml\n${rawText}\n\`\`\``;
  }
  return statusLine + rawText;
}

// ---------------------------------------------------------------------------
// In-process module
// ---------------------------------------------------------------------------

export class FetchUrlInProcess implements InProcessMCPModule {
  [key: string]: unknown;

  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'web_fetch_url',
        description: 'Fetch a URL via HTTP GET and return the content as markdown. Supports HTML pages (including form extraction), JSON APIs, and plain text. HTML is converted to clean markdown; forms are rendered with their fields so you can submit them using web_submit_form.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch',
            },
            headers: {
              type: 'object',
              description: 'Optional HTTP headers to include in the request',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'web_submit_form',
        description: 'Submit an HTML form by sending form field values to a URL. Use after web_fetch_url to fill in and submit forms you found on a page. Supports GET and POST with URL-encoded or multipart encoding.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The form action URL to submit to',
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST'],
              default: 'POST',
              description: 'HTTP method (default: POST)',
            },
            fields: {
              type: 'object',
              description: 'Form field names and their values to submit',
              additionalProperties: { type: 'string' },
            },
            enctype: {
              type: 'string',
              enum: ['application/x-www-form-urlencoded', 'multipart/form-data'],
              default: 'application/x-www-form-urlencoded',
              description: 'Form encoding type (default: application/x-www-form-urlencoded)',
            },
            headers: {
              type: 'object',
              description: 'Optional additional HTTP headers',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['url'],
        },
      },
    ];
  }

  async web_fetch_url(args: {
    url: string;
    headers?: Record<string, string>;
  }): Promise<{ type: 'text'; text: string }> {
    const { url, headers = {} } = args;

    try {
      const response = await safeFetch(url, {
        method: 'GET',
        headers: buildRequestHeaders(headers),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const text = await processResponse(response);
      return { type: 'text', text };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { type: 'text', text: `**Error fetching URL**: ${msg}` };
    }
  }

  async web_submit_form(args: {
    url: string;
    method?: 'GET' | 'POST';
    fields?: Record<string, string>;
    enctype?: 'application/x-www-form-urlencoded' | 'multipart/form-data';
    headers?: Record<string, string>;
  }): Promise<{ type: 'text'; text: string }> {
    const {
      url,
      method = 'POST',
      fields = {},
      enctype = 'application/x-www-form-urlencoded',
      headers = {},
    } = args;

    try {
      let finalUrl = url;
      let body: string | FormData | undefined;
      const reqHeaders = buildRequestHeaders(headers);

      if (method === 'GET') {
        const params = new URLSearchParams(fields);
        const separator = url.includes('?') ? '&' : '?';
        finalUrl = params.toString() ? `${url}${separator}${params.toString()}` : url;
      } else {
        if (enctype === 'multipart/form-data') {
          const formData = new FormData();
          for (const [k, v] of Object.entries(fields)) {
            formData.append(k, v);
          }
          body = formData;
          // Do not set Content-Type for multipart — fetch sets it with boundary automatically
        } else {
          body = new URLSearchParams(fields).toString();
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      }

      const response = await safeFetch(finalUrl, {
        method,
        headers: reqHeaders,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const text = await processResponse(response);
      return { type: 'text', text };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { type: 'text', text: `**Error submitting form**: ${msg}` };
    }
  }

  async getResources(): Promise<[]> {
    return [];
  }
}

export default FetchUrlInProcess;
