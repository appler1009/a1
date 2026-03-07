/**
 * Google Calendar In-Process MCP Module
 *
 * Uses google-calendar-mcp-lib for direct in-process Google Calendar API calls.
 * This provides lower latency compared to STDIO-based MCP servers.
 *
 * Tools provided:
 * - googleCalendarListCalendars - List all calendars
 * - googleCalendarListEvents - List events from a calendar
 * - googleCalendarGetEvent - Get a specific event by ID
 * - googleCalendarCreateEvent - Create a new event
 * - googleCalendarUpdateEvent - Update an existing event
 * - googleCalendarDeleteEvent - Delete an event
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import {
  googleCalendarListCalendars,
  googleCalendarListEvents,
  googleCalendarGetEvent,
  googleCalendarCreateEvent,
  googleCalendarUpdateEvent,
  googleCalendarDeleteEvent,
} from 'google-calendar-mcp-lib';

/**
 * Token data passed from the adapter factory
 */
interface GoogleTokenData {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
}

/**
 * Google Calendar In-Process MCP Module
 *
 * Provides tools for Google Calendar operations using the google-calendar-mcp-lib package.
 */
export class GoogleCalendarInProcess implements InProcessMCPModule {
  private accessToken: string;

  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor(tokenData: GoogleTokenData) {
    this.accessToken = tokenData.access_token;
    console.log('[GoogleCalendarInProcess] Initialized with token data');
  }

  /**
   * List all available tools
   */
  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'googleCalendarListCalendars',
        description: 'List all calendars in the user\'s calendar list',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'googleCalendarListEvents',
        description: 'List events from a calendar. Supports filtering by time range, search query, and more.',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'The calendar ID (use "primary" for the primary calendar)',
            },
            timeMin: {
              type: 'string',
              description: 'Start time in RFC3339 format (e.g., 2024-01-01T00:00:00Z)',
            },
            timeMax: {
              type: 'string',
              description: 'End time in RFC3339 format (e.g., 2024-01-02T00:00:00Z)',
            },
            query: {
              type: 'string',
              description: 'Free-text search query to match event details',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of events to return (default: 250)',
            },
            orderBy: {
              type: 'string',
              enum: ['startTime', 'updated'],
              description: 'Order of events to return',
            },
          },
        },
      },
      {
        name: 'googleCalendarGetEvent',
        description: 'Get a specific event by ID from a calendar',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'The calendar ID (use "primary" for the primary calendar)',
            },
            eventId: {
              type: 'string',
              description: 'The event ID',
            },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'googleCalendarCreateEvent',
        description: 'Create a new event in a calendar',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'The calendar ID (use "primary" for the primary calendar)',
            },
            summary: {
              type: 'string',
              description: 'Event title/summary',
            },
            description: {
              type: 'string',
              description: 'Event description',
            },
            location: {
              type: 'string',
              description: 'Event location',
            },
            start: {
              type: 'object',
              properties: {
                dateTime: { type: 'string' },
                date: { type: 'string' },
                timeZone: { type: 'string' },
              },
              description: 'Start date/time (either dateTime or date required)',
            },
            end: {
              type: 'object',
              properties: {
                dateTime: { type: 'string' },
                date: { type: 'string' },
                timeZone: { type: 'string' },
              },
              description: 'End date/time (either dateTime or date required)',
            },
            attendees: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  displayName: { type: 'string' },
                },
              },
              description: 'Array of attendees with email addresses',
            },
          },
          required: ['summary', 'start', 'end'],
        },
      },
      {
        name: 'googleCalendarUpdateEvent',
        description: 'Update an existing event in a calendar (all fields except eventId are optional)',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'The calendar ID (use "primary" for the primary calendar)',
            },
            eventId: {
              type: 'string',
              description: 'The event ID to update',
            },
            summary: {
              type: 'string',
              description: 'New event title/summary',
            },
            description: {
              type: 'string',
              description: 'New event description',
            },
            location: {
              type: 'string',
              description: 'New event location',
            },
            start: {
              type: 'object',
              properties: {
                dateTime: { type: 'string' },
                date: { type: 'string' },
                timeZone: { type: 'string' },
              },
            },
            end: {
              type: 'object',
              properties: {
                dateTime: { type: 'string' },
                date: { type: 'string' },
                timeZone: { type: 'string' },
              },
            },
            attendees: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  displayName: { type: 'string' },
                },
              },
            },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'googleCalendarDeleteEvent',
        description: 'Delete an event from a calendar',
        inputSchema: {
          type: 'object',
          properties: {
            calendarId: {
              type: 'string',
              description: 'The calendar ID (use "primary" for the primary calendar)',
            },
            eventId: {
              type: 'string',
              description: 'The event ID to delete',
            },
            sendUpdates: {
              type: 'string',
              enum: ['all', 'externalOnly', 'none'],
              description: 'Whether to send notifications about the deletion',
            },
          },
          required: ['eventId'],
        },
      },
    ];
  }

  /**
   * Tool: List all calendars
   */
  async googleCalendarListCalendars(_args: unknown): Promise<unknown> {
    console.log('[GoogleCalendarInProcess:googleCalendarListCalendars] Listing calendars');
    try {
      const result = await googleCalendarListCalendars({ accessToken: this.accessToken });
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GoogleCalendarInProcess:googleCalendarListCalendars] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Tool: List events from a calendar
   */
  async googleCalendarListEvents(args: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    query?: string;
    maxResults?: number;
    orderBy?: string;
    showDeleted?: boolean;
    pageToken?: string;
  }): Promise<unknown> {
    console.log('[GoogleCalendarInProcess:googleCalendarListEvents] Listing events');
    try {
      const result = await googleCalendarListEvents({
        accessToken: this.accessToken,
        ...args,
      });
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GoogleCalendarInProcess:googleCalendarListEvents] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Tool: Get a specific event
   */
  async googleCalendarGetEvent(args: { calendarId?: string; eventId: string }): Promise<unknown> {
    console.log('[GoogleCalendarInProcess:googleCalendarGetEvent] Getting event:', args.eventId);
    try {
      const result = await googleCalendarGetEvent({
        accessToken: this.accessToken,
        ...args,
      });
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GoogleCalendarInProcess:googleCalendarGetEvent] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Tool: Create a new event
   */
  async googleCalendarCreateEvent(args: {
    calendarId?: string;
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: { email: string; displayName?: string }[];
    recurrence?: string[];
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<unknown> {
    console.log('[GoogleCalendarInProcess:googleCalendarCreateEvent] Creating event:', args.summary);
    try {
      const result = await googleCalendarCreateEvent({
        accessToken: this.accessToken,
        ...args,
      });
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GoogleCalendarInProcess:googleCalendarCreateEvent] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Tool: Update an event
   */
  async googleCalendarUpdateEvent(args: {
    calendarId?: string;
    eventId: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: { email: string; displayName?: string }[];
    recurrence?: string[];
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<unknown> {
    console.log('[GoogleCalendarInProcess:googleCalendarUpdateEvent] Updating event:', args.eventId);
    try {
      const result = await googleCalendarUpdateEvent({
        accessToken: this.accessToken,
        ...args,
      });
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GoogleCalendarInProcess:googleCalendarUpdateEvent] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Tool: Delete an event
   */
  async googleCalendarDeleteEvent(args: {
    calendarId?: string;
    eventId: string;
    sendUpdates?: 'all' | 'externalOnly' | 'none';
  }): Promise<unknown> {
    console.log('[GoogleCalendarInProcess:googleCalendarDeleteEvent] Deleting event:', args.eventId);
    try {
      const result = await googleCalendarDeleteEvent({
        accessToken: this.accessToken,
        ...args,
      });
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GoogleCalendarInProcess:googleCalendarDeleteEvent] Error:', errorMsg);
      throw error;
    }
  }
}
