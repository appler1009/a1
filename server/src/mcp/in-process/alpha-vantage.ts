/**
 * Alpha Vantage In-Process MCP Module
 *
 * Wraps the Alpha Vantage REST API for financial data.
 * Requires a free API key from alphavantage.co.
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';

const BASE_URL = 'https://www.alphavantage.co/query';

export const ALPHA_VANTAGE_API_REFERENCE = `# Alpha Vantage Financial Data API Reference

Alpha Vantage provides real-time and historical financial data via REST API.
Base URL: https://www.alphavantage.co/query
Free API key required: https://www.alphavantage.co/support/#api-key

## Core Stock Data

### GLOBAL_QUOTE
Latest price, volume, and change for a stock.
Parameters: symbol (required)
Returns: open, high, low, price, volume, previous close, change, change percent

### TIME_SERIES_DAILY
Daily OHLCV time series for a stock.
Parameters: symbol (required), outputsize (compact=100 points, full=20+ years)
Returns: daily open, high, low, close, volume

### TIME_SERIES_INTRADAY
Intraday OHLCV time series.
Parameters: symbol (required), interval (1min/5min/15min/30min/60min), outputsize
Returns: intraday bars at specified interval

## Search & Discovery

### SYMBOL_SEARCH
Search for stock symbols and company names.
Parameters: keywords (required)
Returns: matching symbols, names, regions, and types

## Market Intelligence

### NEWS_SENTIMENT
News articles with sentiment scores for stocks or topics.
Parameters: tickers (optional), topics (optional), time_from, time_to, limit
Topics: earnings, ipo, mergers_and_acquisitions, financial_markets, economy_fiscal,
        economy_monetary, economy_macro, energy_transportation, finance, life_sciences,
        manufacturing, real_estate, retail_wholesale, technology
Returns: articles with title, url, source, summary, sentiment scores per ticker

### TOP_GAINERS_LOSERS
Top gaining, losing, and most active US stocks for the current trading day.
Parameters: none
Returns: top_gainers, top_losers, most_actively_traded arrays with price/volume data

## Fundamentals

### COMPANY_OVERVIEW
Complete fundamental data for a company.
Parameters: symbol (required)
Returns: description, sector, industry, market cap, P/E ratio, EPS, dividend yield,
         52-week high/low, 50-day and 200-day moving averages, book value, beta, and 50+ more

### EARNINGS
Quarterly and annual EPS history.
Parameters: symbol (required)
Returns: annualEarnings and quarterlyEarnings arrays with reported/estimated EPS and surprise

## Foreign Exchange (Forex)

### CURRENCY_EXCHANGE_RATE
Real-time exchange rate between any two currencies or crypto.
Parameters: from_currency (e.g. USD, EUR, BTC), to_currency (e.g. JPY, GBP, ETH)
Returns: exchange rate, bid/ask prices, last refreshed timestamp

## Economic Indicators

### REAL_GDP
US real gross domestic product.
Parameters: interval (annual or quarterly)
Returns: time series of real GDP values in billions of USD

### CPI
US Consumer Price Index (inflation measure).
Parameters: interval (monthly or semiannual)
Returns: time series of CPI values (base year 1982-1984 = 100)

### WTI
West Texas Intermediate crude oil prices.
Parameters: interval (daily, weekly, or monthly)
Returns: time series of WTI crude oil prices in USD per barrel

## Rate Limits
Free tier: 25 API calls per day, 5 per minute.
For higher limits, see https://www.alphavantage.co/premium/

## Common Error Responses
- "Error Message": Invalid API call (bad function name or parameters)
- "Information": API rate limit exceeded
- "Note": Occasional API rate limit note (data may still be returned)
`;

export class AlphaVantageInProcess implements InProcessMCPModule {
  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor(private apiKey: string) {
    console.log('[AlphaVantageInProcess] Initialized');
  }

  private async fetchAV(params: Record<string, string>): Promise<any> {
    const url = new URL(BASE_URL);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    url.searchParams.set('apikey', this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as Record<string, unknown>;

    // Alpha Vantage returns error messages in the JSON body
    if (data['Error Message']) {
      throw new Error(`Alpha Vantage error: ${data['Error Message']}`);
    }
    if (data['Note']) {
      // Rate limit note — still return the data (may be partial)
      console.warn('[AlphaVantageInProcess] Rate limit note:', data['Note']);
    }
    if (data['Information']) {
      throw new Error(`Alpha Vantage: ${data['Information']}`);
    }

    return data;
  }

  getSystemPromptSummary(): string {
    return 'Alpha Vantage — look up real-time and historical stock prices and market data.';
  }

  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'globalQuote',
        description: 'Get the latest price, volume, and change information for a stock symbol.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol (e.g. AAPL, MSFT)' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'timeSeriesDaily',
        description: 'Get daily OHLCV (open, high, low, close, volume) time series for a stock.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
            outputsize: {
              type: 'string',
              enum: ['compact', 'full'],
              description: 'compact = last 100 data points; full = 20+ years of history',
            },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'timeSeriesIntraday',
        description: 'Get intraday OHLCV time series for a stock at a specified interval.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
            interval: {
              type: 'string',
              enum: ['1min', '5min', '15min', '30min', '60min'],
              description: 'Time interval between data points',
            },
            outputsize: {
              type: 'string',
              enum: ['compact', 'full'],
              description: 'compact = last 100 data points; full = full history',
            },
          },
          required: ['symbol', 'interval'],
        },
      },
      {
        name: 'symbolSearch',
        description: 'Search for stock symbols and company names matching a keyword.',
        inputSchema: {
          type: 'object',
          properties: {
            keywords: { type: 'string', description: 'Company name or symbol keyword to search' },
          },
          required: ['keywords'],
        },
      },
      {
        name: 'newsSentiment',
        description: 'Get news and sentiment data for stocks, topics, or general market news.',
        inputSchema: {
          type: 'object',
          properties: {
            tickers: {
              type: 'string',
              description: 'Comma-separated stock tickers (e.g. AAPL,MSFT). Optional.',
            },
            topics: {
              type: 'string',
              description: 'Comma-separated topics (e.g. earnings,ipo,mergers_and_acquisitions,technology,real_estate,finance). Optional.',
            },
            time_from: {
              type: 'string',
              description: 'Start time in YYYYMMDDTHHMM format (e.g. 20240101T0000). Optional.',
            },
            time_to: {
              type: 'string',
              description: 'End time in YYYYMMDDTHHMM format. Optional.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of news items to return (default 50, max 1000).',
            },
          },
          required: [],
        },
      },
      {
        name: 'companyOverview',
        description: 'Get fundamental company data: description, P/E ratio, market cap, sector, industry, EPS, dividend yield, and 50+ other metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'EARNINGS',
        description: 'Get quarterly and annual EPS (earnings per share) history for a company.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Stock ticker symbol' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'currencyExchangeRate',
        description: 'Get real-time exchange rate between two currencies (forex or crypto).',
        inputSchema: {
          type: 'object',
          properties: {
            from_currency: { type: 'string', description: 'Source currency code (e.g. USD, EUR, BTC)' },
            to_currency: { type: 'string', description: 'Target currency code (e.g. USD, EUR, JPY)' },
          },
          required: ['from_currency', 'to_currency'],
        },
      },
      {
        name: 'realGdp',
        description: 'Get US real gross domestic product (GDP) data.',
        inputSchema: {
          type: 'object',
          properties: {
            interval: {
              type: 'string',
              enum: ['annual', 'quarterly'],
              description: 'Data frequency (default: annual)',
            },
          },
          required: [],
        },
      },
      {
        name: 'CPI',
        description: 'Get US Consumer Price Index (CPI) data, a measure of inflation.',
        inputSchema: {
          type: 'object',
          properties: {
            interval: {
              type: 'string',
              enum: ['monthly', 'semiannual'],
              description: 'Data frequency (default: monthly)',
            },
          },
          required: [],
        },
      },
      {
        name: 'WTI',
        description: 'Get West Texas Intermediate (WTI) crude oil prices.',
        inputSchema: {
          type: 'object',
          properties: {
            interval: {
              type: 'string',
              enum: ['daily', 'weekly', 'monthly'],
              description: 'Data frequency (default: monthly)',
            },
          },
          required: [],
        },
      },
      {
        name: 'topGainersLosers',
        description: 'Get top gaining, top losing, and most actively traded US stocks for the current trading day.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ];
  }

  async globalQuote(args: { symbol: string }): Promise<any> {
    return this.fetchAV({ function: 'GLOBAL_QUOTE', symbol: args.symbol });
  }

  async timeSeriesDaily(args: { symbol: string; outputsize?: string }): Promise<any> {
    const params: Record<string, string> = {
      function: 'TIME_SERIES_DAILY',
      symbol: args.symbol,
    };
    if (args.outputsize) params.outputsize = args.outputsize;
    return this.fetchAV(params);
  }

  async timeSeriesIntraday(args: { symbol: string; interval: string; outputsize?: string }): Promise<any> {
    const params: Record<string, string> = {
      function: 'TIME_SERIES_INTRADAY',
      symbol: args.symbol,
      interval: args.interval,
    };
    if (args.outputsize) params.outputsize = args.outputsize;
    return this.fetchAV(params);
  }

  async symbolSearch(args: { keywords: string }): Promise<any> {
    return this.fetchAV({ function: 'SYMBOL_SEARCH', keywords: args.keywords });
  }

  async newsSentiment(args: {
    tickers?: string;
    topics?: string;
    time_from?: string;
    time_to?: string;
    limit?: number;
  }): Promise<any> {
    const params: Record<string, string> = { function: 'NEWS_SENTIMENT' };
    if (args.tickers) params.tickers = args.tickers;
    if (args.topics) params.topics = args.topics;
    if (args.time_from) params.time_from = args.time_from;
    if (args.time_to) params.time_to = args.time_to;
    if (args.limit !== undefined) params.limit = String(args.limit);
    return this.fetchAV(params);
  }

  async companyOverview(args: { symbol: string }): Promise<any> {
    return this.fetchAV({ function: 'OVERVIEW', symbol: args.symbol });
  }

  async EARNINGS(args: { symbol: string }): Promise<any> {
    return this.fetchAV({ function: 'EARNINGS', symbol: args.symbol });
  }

  async currencyExchangeRate(args: { from_currency: string; to_currency: string }): Promise<any> {
    return this.fetchAV({
      function: 'CURRENCY_EXCHANGE_RATE',
      from_currency: args.from_currency,
      to_currency: args.to_currency,
    });
  }

  async realGdp(args: { interval?: string }): Promise<any> {
    const params: Record<string, string> = { function: 'REAL_GDP' };
    if (args.interval) params.interval = args.interval;
    return this.fetchAV(params);
  }

  async CPI(args: { interval?: string }): Promise<any> {
    const params: Record<string, string> = { function: 'CPI' };
    if (args.interval) params.interval = args.interval;
    return this.fetchAV(params);
  }

  async WTI(args: { interval?: string }): Promise<any> {
    const params: Record<string, string> = { function: 'WTI' };
    if (args.interval) params.interval = args.interval;
    return this.fetchAV(params);
  }

  async topGainersLosers(_args: Record<string, never>): Promise<any> {
    return this.fetchAV({ function: 'TOP_GAINERS_LOSERS' });
  }

  close(): void {
    // No connections to close for REST API
  }
}
