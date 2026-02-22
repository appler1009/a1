/**
 * Weather In-Process MCP Module
 * 
 * Wraps the @dangahagan/weather-mcp package for direct in-process calls.
 * Uses the package's handlers directly without MCP protocol overhead.
 * 
 * No API keys required.
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';

// Import services from weather-mcp
import { NOAAService } from '@dangahagan/weather-mcp/dist/services/noaa.js';
import { OpenMeteoService } from '@dangahagan/weather-mcp/dist/services/openmeteo.js';
import { NCEIService } from '@dangahagan/weather-mcp/dist/services/ncei.js';
import { NIFCService } from '@dangahagan/weather-mcp/dist/services/nifc.js';

// Import handlers from weather-mcp
import { handleGetForecast } from '@dangahagan/weather-mcp/dist/handlers/forecastHandler.js';
import { handleGetCurrentConditions } from '@dangahagan/weather-mcp/dist/handlers/currentConditionsHandler.js';
import { handleGetAlerts } from '@dangahagan/weather-mcp/dist/handlers/alertsHandler.js';
import { handleGetHistoricalWeather } from '@dangahagan/weather-mcp/dist/handlers/historicalWeatherHandler.js';
import { handleSearchLocation } from '@dangahagan/weather-mcp/dist/handlers/locationHandler.js';
import { handleGetAirQuality } from '@dangahagan/weather-mcp/dist/handlers/airQualityHandler.js';
import { handleGetMarineConditions } from '@dangahagan/weather-mcp/dist/handlers/marineConditionsHandler.js';
import { getLightningActivity, formatLightningActivityResponse } from '@dangahagan/weather-mcp/dist/handlers/lightningHandler.js';
import { handleGetRiverConditions } from '@dangahagan/weather-mcp/dist/handlers/riverConditionsHandler.js';
import { handleGetWildfireInfo } from '@dangahagan/weather-mcp/dist/handlers/wildfireHandler.js';

/**
 * Weather In-Process MCP Module
 * 
 * Provides tools by calling weather-mcp handlers directly.
 */
export class WeatherInProcess implements InProcessMCPModule {
  private noaaService: NOAAService;
  private openMeteoService: OpenMeteoService;
  private nceiService: NCEIService;
  private nifcService: NIFCService;

  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor() {
    this.noaaService = new NOAAService({
      userAgent: 'local-agent-mcp/1.0'
    });
    this.openMeteoService = new OpenMeteoService();
    this.nceiService = new NCEIService();
    this.nifcService = new NIFCService();
    
    console.log('[WeatherInProcess] Initialized with weather-mcp handlers');
  }

  /**
   * List all available tools
   */
  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'get_forecast',
        description: 'Get weather forecast for a location (global coverage). Returns forecast data including temperature, precipitation, wind, conditions.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
            days: { type: 'number', description: 'Number of days (1-16)', default: 7 },
            granularity: { type: 'string', enum: ['daily', 'hourly'], default: 'daily' },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_current_conditions',
        description: 'Get current weather conditions for a location (US only). Returns latest observation from nearest weather station.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_alerts',
        description: 'Get active weather alerts, watches, warnings for a location (US only).',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_historical_weather',
        description: 'Get historical weather data for a date range (1940-present).',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
            start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
            end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          },
          required: ['latitude', 'longitude', 'start_date', 'end_date'],
        },
      },
      {
        name: 'search_location',
        description: 'Search for a location by name to get coordinates.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Location name to search' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_air_quality',
        description: 'Get air quality index for a location.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_marine_conditions',
        description: 'Get marine conditions (waves, swell) for a coastal location.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_lightning_activity',
        description: 'Get recent lightning activity for a location.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_river_conditions',
        description: 'Get river conditions for a location (US only).',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
          },
          required: ['latitude', 'longitude'],
        },
      },
      {
        name: 'get_wildfire_info',
        description: 'Get wildfire information for a location.',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
            longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
          },
          required: ['latitude', 'longitude'],
        },
      },
    ];
  }

  /**
   * Helper to extract text from MCP response
   */
  private extractResponseText(response: { content: Array<{ type: string; text: string }> }): any {
    if (response.content && response.content[0]?.type === 'text') {
      try {
        return JSON.parse(response.content[0].text);
      } catch {
        return response.content[0].text;
      }
    }
    return response;
  }

  /**
   * Determine if coordinates are in Canada (more accurate than the handler's isInUS)
   * The weather-mcp handler's isInUS() uses a bounding box that incorrectly includes
   * parts of Canada near the US border (like Vancouver BC at 49.25°N).
   * 
   * This uses a more precise check for Canadian territory.
   */
  private isInCanada(latitude: number, longitude: number): boolean {
    // Canada bounding boxes (rough approximation but more accurate than isInUS)
    // Southern Canada border is roughly at 49°N for most of the west,
    // but dips down around the Great Lakes
    
    // British Columbia / Alberta - US border is at 49°N
    const inWesternCanada = latitude >= 49.0 && latitude <= 60.0 && longitude >= -141.0 && longitude < -114.0;
    
    // Prairie Provinces (SK, MB) - border at 49°N
    const inPrairieCanada = latitude >= 49.0 && latitude <= 60.0 && longitude >= -114.0 && longitude < -95.0;
    
    // Ontario - border dips south around Lake of the Woods and Great Lakes
    // The border goes as far south as ~41.7°N in Lake Erie
    const inOntario = latitude >= 41.7 && latitude <= 56.0 && longitude >= -95.0 && longitude < -74.0;
    
    // Quebec - border at 45°N in the east
    const inQuebec = latitude >= 45.0 && latitude <= 62.0 && longitude >= -79.5 && longitude < -57.0;
    
    // Atlantic Provinces
    const inAtlanticCanada = latitude >= 43.5 && latitude <= 52.0 && longitude >= -67.5 && longitude < -52.0;
    
    // Territories (Yukon, NWT, Nunavut)
    const inNorthernCanada = latitude >= 60.0 && latitude <= 84.0 && longitude >= -141.0 && longitude < -52.0;
    
    return inWesternCanada || inPrairieCanada || inOntario || inQuebec || inAtlanticCanada || inNorthernCanada;
  }

  /**
   * Tool: Get weather forecast
   * 
   * Forces Open-Meteo for Canadian locations to work around the handler's
   * inaccurate isInUS() bounding box that incorrectly routes Canadian border
   * cities (like Vancouver BC) to NOAA.
   */
  async get_forecast(args: { latitude: number; longitude: number; days?: number; granularity?: string }): Promise<any> {
    // Check if location is in Canada - if so, force Open-Meteo
    const source = this.isInCanada(args.latitude, args.longitude) ? 'openmeteo' : 'auto';
    
    if (source === 'openmeteo') {
      console.log(`[WeatherInProcess] Forcing Open-Meteo for Canadian location: ${args.latitude.toFixed(4)}, ${args.longitude.toFixed(4)}`);
    }
    
    const result = await handleGetForecast(
      { ...args, source },
      this.noaaService,
      this.openMeteoService,
      this.nceiService
    );
    return this.extractResponseText(result);
  }

  /**
   * Tool: Get current conditions
   */
  async get_current_conditions(args: { latitude: number; longitude: number }): Promise<any> {
    const result = await handleGetCurrentConditions(
      args,
      this.noaaService,
      this.openMeteoService,
      this.nceiService
    );
    return this.extractResponseText(result);
  }

  /**
   * Tool: Get weather alerts
   */
  async get_alerts(args: { latitude: number; longitude: number }): Promise<any> {
    const result = await handleGetAlerts(args, this.noaaService);
    return this.extractResponseText(result);
  }

  /**
   * Tool: Get historical weather
   */
  async get_historical_weather(args: { latitude: number; longitude: number; start_date: string; end_date: string }): Promise<any> {
    const result = await handleGetHistoricalWeather(
      args,
      this.noaaService,
      this.openMeteoService
    );
    return this.extractResponseText(result);
  }

  /**
   * Tool: Search location
   * 
   * Handles Open-Meteo Geocoding API limitation where qualified names
   * (e.g., "Vancouver BC", "Paris France") return no results.
   * Falls back to simpler queries if the full query fails.
   */
  async search_location(args: { query: string }): Promise<any> {
    // Try the original query first
    try {
      const result = await handleSearchLocation(args, this.openMeteoService);
      return this.extractResponseText(result);
    } catch (error: unknown) {
      // Check if it's a "no results" error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('No locations found')) {
        // Try progressively simpler queries
        const simplifiedQueries = this.simplifyQuery(args.query);
        
        for (const simplified of simplifiedQueries) {
          if (simplified === args.query) continue; // Skip the original query we already tried
          
          console.log(`[WeatherInProcess] Retrying location search with simplified query: "${simplified}" (original: "${args.query}")`);
          
          try {
            const result = await handleSearchLocation({ query: simplified }, this.openMeteoService);
            const extracted = this.extractResponseText(result);
            
            // If we got results with a simplified query, add a note about the original query
            if (extracted && typeof extracted === 'string') {
              return extracted.replace(
                '**Query:**',
                `**Original Query:** "${args.query}"\n**Searched As:** "${simplified}"\n**Query:**`
              );
            }
            return extracted;
          } catch {
            // Continue to next simplified query
            continue;
          }
        }
      }
      // Re-throw the original error if no simplified query worked
      throw error;
    }
  }

  /**
   * Generate simplified versions of a location query
   * Open-Meteo Geocoding API doesn't handle province/state abbreviations well
   * 
   * @param query - Original location query
   * @returns Array of progressively simpler queries to try
   */
  private simplifyQuery(query: string): string[] {
    const queries: string[] = [query];
    
    // Common patterns to strip:
    // - Province/state abbreviations: "Vancouver BC" -> "Vancouver"
    // - Country names: "Paris France" -> "Paris"
    // - Comma-separated: "Vancouver, BC" -> "Vancouver"
    
    // Remove common province/state abbreviations (2-3 letter codes)
    const provinceAbbrPattern = /[, ]+[A-Z]{2,3}$/;
    if (provinceAbbrPattern.test(query)) {
      queries.push(query.replace(provinceAbbrPattern, '').trim());
    }
    
    // Remove country names at the end
    const countryPatterns = [
      /,?\s*Canada$/i,
      /,?\s*USA?$/i,
      /,?\s*United States$/i,
      /,?\s*United Kingdom$/i,
      /,?\s*UK$/i,
      /,?\s*France$/i,
      /,?\s*Germany$/i,
      /,?\s*Australia$/i,
      /,?\s*Japan$/i,
      /,?\s*China$/i,
      /,?\s*India$/i,
      /,?\s*Brazil$/i,
      /,?\s*Mexico$/i,
    ];
    
    for (const pattern of countryPatterns) {
      if (pattern.test(query)) {
        queries.push(query.replace(pattern, '').trim());
      }
    }
    
    // If query has comma, try just the first part
    if (query.includes(',')) {
      const firstPart = query.split(',')[0].trim();
      if (firstPart.length >= 2) {
        queries.push(firstPart);
      }
    }
    
    // If query has spaces, try just the first word (for cases like "Vancouver BC")
    if (query.includes(' ')) {
      const parts = query.split(/\s+/);
      // Try first word only if it's long enough
      if (parts[0].length >= 3) {
        queries.push(parts[0]);
      }
      // Try all but last word (for "New York NY" -> "New York")
      if (parts.length > 2) {
        queries.push(parts.slice(0, -1).join(' '));
      }
    }
    
    // Remove duplicates while preserving order
    return [...new Set(queries)];
  }

  /**
   * Tool: Get air quality
   */
  async get_air_quality(args: { latitude: number; longitude: number }): Promise<any> {
    const result = await handleGetAirQuality(args, this.openMeteoService);
    return this.extractResponseText(result);
  }

  /**
   * Tool: Get marine conditions
   */
  async get_marine_conditions(args: { latitude: number; longitude: number }): Promise<any> {
    const result = await handleGetMarineConditions(args, this.noaaService, this.openMeteoService);
    return this.extractResponseText(result);
  }

  /**
   * Tool: Get lightning activity
   */
  async get_lightning_activity(args: { latitude: number; longitude: number }): Promise<any> {
    const data = await getLightningActivity(args);
    return formatLightningActivityResponse(data);
  }

  /**
   * Tool: Get river conditions
   */
  async get_river_conditions(args: { latitude: number; longitude: number }): Promise<any> {
    const result = await handleGetRiverConditions(args, this.noaaService);
    return this.extractResponseText(result);
  }

  /**
   * Tool: Get wildfire info
   */
  async get_wildfire_info(args: { latitude: number; longitude: number }): Promise<any> {
    const result = await handleGetWildfireInfo(args, this.nifcService);
    return this.extractResponseText(result);
  }

  /**
   * Close any connections
   */
  close(): void {
    // Clear caches
    this.openMeteoService.clearCache();
  }
}
