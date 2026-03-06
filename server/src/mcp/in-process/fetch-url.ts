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

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import { parse as parseHtml, type HTMLElement, type Node } from 'node-html-parser';

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

  if (contentType.includes('application/json') || contentType.includes('+json')) {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }
    return statusLine + jsonToMarkdown(data);
  }

  if (contentType.includes('text/html')) {
    const html = await response.text();
    return statusLine + htmlToMarkdown(html);
  }

  // Plain text, XML, CSV, etc.
  const text = await response.text();
  if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
    return statusLine + `\`\`\`xml\n${text}\n\`\`\``;
  }
  return statusLine + text;
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
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; local-agent/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
          ...headers,
        },
        redirect: 'follow',
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
      const reqHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (compatible; local-agent/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        ...headers,
      };

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

      const response = await fetch(finalUrl, {
        method,
        headers: reqHeaders,
        body,
        redirect: 'follow',
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
