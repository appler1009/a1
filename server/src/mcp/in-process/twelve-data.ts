/**
 * Twelve Data In-Process MCP Module
 *
 * Wraps the Twelve Data REST API for financial market data.
 * Requires a free API key from twelvedata.com.
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';

const BASE_URL = 'https://api.twelvedata.com';

export class TwelveDataInProcess implements InProcessMCPModule {
  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor(private apiKey: string) {
    console.log('[TwelveDataInProcess] Initialized');
  }

  private async fetchTwelveData(endpoint: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`${BASE_URL}${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `apikey ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Twelve Data API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Check for API error responses
    if (data['status'] === 'error') {
      throw new Error(`Twelve Data error: ${data['message'] || 'Unknown error'}`);
    }

    return data;
  }

  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'quote',
        description: 'Get real-time stock quote with current price, volume, change, and other market data.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol (e.g. AAPL, MSFT, GOOGL)' },
            exchange: {
              type: 'string',
              description: 'Exchange code (optional, e.g. NASDAQ, NYSE). Auto-detected if omitted.',
            },
            dp: {
              type: 'number',
              description: 'Decimal places for price (0-11, default: 2)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'timeSeries',
        description: 'Get historical OHLCV (open, high, low, close, volume) time series data for a stock.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            interval: {
              type: 'string',
              enum: ['1min', '5min', '15min', '30min', '1h', '4h', '1day', '1week', '1month'],
              description: 'Time interval (default: 1day)',
            },
            outputsize: {
              type: 'number',
              description: 'Number of data points to return (1-5000, default: 30)',
            },
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format (optional)',
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format (optional)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'price',
        description: 'Get the latest market price for a stock as a single data point.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            exchange: {
              type: 'string',
              description: 'Exchange code (optional, e.g. NASDAQ, NYSE)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'symbolSearch',
        description: 'Search for stock symbols and companies by name or partial symbol match.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Company name or symbol to search for' },
            exchange: {
              type: 'string',
              description: 'Filter by exchange (optional, e.g. NASDAQ, NYSE)',
            },
            type: {
              type: 'string',
              enum: ['stock', 'etf', 'fund', 'index', 'currency', 'crypto'],
              description: 'Asset type to filter (optional)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'profile',
        description: 'Get company fundamental information: sector, industry, employees, description, website, market cap, P/E ratio.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            exchange: {
              type: 'string',
              description: 'Exchange code (optional)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'earnings',
        description: 'Get quarterly and annual earnings per share (EPS) history and earnings dates.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            dp: {
              type: 'number',
              description: 'Decimal places for EPS (0-11, default: 2)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'dividends',
        description: 'Get dividend payment history including amount, ex-date, and payment date.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format (optional)',
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format (optional)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'splits',
        description: 'Get stock split history including split ratios and effective dates.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            startDate: {
              type: 'string',
              description: 'Start date in YYYY-MM-DD format (optional)',
            },
            endDate: {
              type: 'string',
              description: 'End date in YYYY-MM-DD format (optional)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'incomeStatement',
        description: 'Get company income statement (P&L) data: revenue, operating income, net income, EPS.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            period: {
              type: 'string',
              enum: ['quarterly', 'annual'],
              description: 'Report period (default: quarterly)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'balanceSheet',
        description: 'Get company balance sheet data: assets, liabilities, shareholders equity.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            period: {
              type: 'string',
              enum: ['quarterly', 'annual'],
              description: 'Report period (default: quarterly)',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'cashFlow',
        description: 'Get company cash flow statement: operating, investing, and financing cash flows.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock symbol' },
            period: {
              type: 'string',
              enum: ['quarterly', 'annual'],
              description: 'Report period (default: quarterly)',
            },
          },
          required: ['symbol'],
        },
      },
    ];
  }

  async quote(args: { symbol: string; exchange?: string; dp?: number }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.exchange) params.exchange = args.exchange;
    if (args.dp !== undefined) params.dp = String(args.dp);
    return this.fetchTwelveData('/quote', params);
  }

  async timeSeries(args: {
    symbol: string;
    interval?: string;
    outputsize?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.interval) params.interval = args.interval;
    if (args.outputsize !== undefined) params.outputsize = String(args.outputsize);
    if (args.startDate) params.start_date = args.startDate;
    if (args.endDate) params.end_date = args.endDate;
    return this.fetchTwelveData('/time_series', params);
  }

  async price(args: { symbol: string; exchange?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.exchange) params.exchange = args.exchange;
    return this.fetchTwelveData('/price', params);
  }

  async symbolSearch(args: { query: string; exchange?: string; type?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.query };
    if (args.exchange) params.exchange = args.exchange;
    if (args.type) params.type = args.type;
    return this.fetchTwelveData('/symbol_search', params);
  }

  async profile(args: { symbol: string; exchange?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.exchange) params.exchange = args.exchange;
    return this.fetchTwelveData('/profile', params);
  }

  async earnings(args: { symbol: string; dp?: number }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.dp !== undefined) params.dp = String(args.dp);
    return this.fetchTwelveData('/earnings', params);
  }

  async dividends(args: { symbol: string; startDate?: string; endDate?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.startDate) params.start_date = args.startDate;
    if (args.endDate) params.end_date = args.endDate;
    return this.fetchTwelveData('/dividends', params);
  }

  async splits(args: { symbol: string; startDate?: string; endDate?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.startDate) params.start_date = args.startDate;
    if (args.endDate) params.end_date = args.endDate;
    return this.fetchTwelveData('/splits', params);
  }

  async incomeStatement(args: { symbol: string; period?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.period) params.period = args.period;
    return this.fetchTwelveData('/income_statement', params);
  }

  async balanceSheet(args: { symbol: string; period?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.period) params.period = args.period;
    return this.fetchTwelveData('/balance_sheet', params);
  }

  async cashFlow(args: { symbol: string; period?: string }): Promise<any> {
    const params: Record<string, string> = { symbol: args.symbol };
    if (args.period) params.period = args.period;
    return this.fetchTwelveData('/cash_flow', params);
  }

  close(): void {
    // No connections to close for REST API
  }
}
