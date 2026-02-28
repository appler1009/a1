/**
 * SQLite Memory In-Process MCP Module
 * 
 * This module provides direct in-process access to SQLite-based memory storage
 * for knowledge graph operations (entities, relations, observations).
 * 
 * Benefits:
 * - Lower latency (no process spawning/IPC overhead)
 * - Better debugging (direct stack traces)
 * - Simpler deployment
 * - Direct SQLite access for persistence
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import { Database } from 'bun:sqlite';

/**
 * Entity in the knowledge graph
 */
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

/**
 * Relation between entities
 */
interface Relation {
  from: string;
  to: string;
  relationType: string;
}

/**
 * SQLite Memory In-Process MCP Module
 * 
 * Provides tools for:
 * - Creating entities
 * - Creating relations
 * - Adding observations
 * - Deleting entities
 * - Deleting observations
 * - Deleting relations
 * - Reading the full graph
 * - Searching nodes
 * - Opening specific nodes
 */
export class SQLiteMemoryInProcess implements InProcessMCPModule {
  private db: Database | null = null;
  private dbPath: string;

  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    console.log(`[SQLiteMemoryInProcess] Initialized with db path: ${dbPath}`);
  }

  /**
   * Initialize the SQLite database
   */
  private ensureDb(): Database {
    if (this.db) {
      return this.db;
    }

    console.log('[SQLiteMemoryInProcess] Initializing SQLite database...');
    
    this.db = new Database(this.dbPath);
    
    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        name TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_name TEXT NOT NULL,
        observation TEXT NOT NULL,
        FOREIGN KEY (entity_name) REFERENCES entities(name) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_entity TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        FOREIGN KEY (from_entity) REFERENCES entities(name) ON DELETE CASCADE,
        FOREIGN KEY (to_entity) REFERENCES entities(name) ON DELETE CASCADE,
        UNIQUE(from_entity, to_entity, relation_type)
      );
      
      CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity);
    `);

    return this.db;
  }

  /**
   * List all available tools
   */
  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'memory_create_entities',
        description: 'Create multiple new entities in the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            entities: {
              type: 'array',
              description: 'Array of entities to create',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'The name of the entity' },
                  entityType: { type: 'string', description: 'The type of the entity' },
                  observations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of observations',
                  },
                },
                required: ['name', 'entityType'],
              },
            },
          },
          required: ['entities'],
        },
      },
      {
        name: 'memory_create_relations',
        description: 'Create multiple new relations between entities',
        inputSchema: {
          type: 'object',
          properties: {
            relations: {
              type: 'array',
              description: 'Array of relations to create',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string', description: 'The name of the source entity' },
                  to: { type: 'string', description: 'The name of the target entity' },
                  relationType: { type: 'string', description: 'The type of relation' },
                },
                required: ['from', 'to', 'relationType'],
              },
            },
          },
          required: ['relations'],
        },
      },
      {
        name: 'memory_add_observations',
        description: 'Add new observations to existing entities',
        inputSchema: {
          type: 'object',
          properties: {
            observations: {
              type: 'array',
              description: 'Array of observations to add',
              items: {
                type: 'object',
                properties: {
                  entityName: { type: 'string', description: 'The name of the entity' },
                  contents: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of observation contents to add',
                  },
                },
                required: ['entityName', 'contents'],
              },
            },
          },
          required: ['observations'],
        },
      },
      {
        name: 'memory_delete_entities',
        description: 'Delete multiple entities from the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            entityNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of entity names to delete',
            },
          },
          required: ['entityNames'],
        },
      },
      {
        name: 'memory_delete_observations',
        description: 'Delete specific observations from entities',
        inputSchema: {
          type: 'object',
          properties: {
            deletions: {
              type: 'array',
              description: 'Array of observations to delete',
              items: {
                type: 'object',
                properties: {
                  entityName: { type: 'string', description: 'The name of the entity' },
                  contents: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of observation contents to delete',
                  },
                },
                required: ['entityName', 'contents'],
              },
            },
          },
          required: ['deletions'],
        },
      },
      {
        name: 'memory_delete_relations',
        description: 'Delete specific relations from the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            relations: {
              type: 'array',
              description: 'Array of relations to delete',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string', description: 'The name of the source entity' },
                  to: { type: 'string', description: 'The name of the target entity' },
                  relationType: { type: 'string', description: 'The type of relation' },
                },
                required: ['from', 'to', 'relationType'],
              },
            },
          },
          required: ['relations'],
        },
      },
      {
        name: 'memory_read_graph',
        description: 'Read the entire knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'memory_search_nodes',
        description: 'Search for nodes in the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query string',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_open_nodes',
        description: 'Open specific nodes by name',
        inputSchema: {
          type: 'object',
          properties: {
            names: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of entity names to open',
            },
          },
          required: ['names'],
        },
      },
    ];
  }

  /**
   * Tool: Create entities
   */
  async memory_create_entities(args: { entities: Array<{ name: string; entityType: string; observations?: string[] }> }): Promise<any> {
    const db = this.ensureDb();
    const insertEntity = db.prepare('INSERT OR REPLACE INTO entities (name, entity_type) VALUES (?, ?)');
    const insertObservation = db.prepare('INSERT INTO observations (entity_name, observation) VALUES (?, ?)');

    const created: Entity[] = [];

    for (const entity of args.entities) {
      insertEntity.run(entity.name, entity.entityType);
      
      if (entity.observations) {
        for (const obs of entity.observations) {
          insertObservation.run(entity.name, obs);
        }
      }
      
      created.push({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations || [],
      });
    }

    return { created, count: created.length };
  }

  /**
   * Tool: Create relations
   */
  async memory_create_relations(args: { relations: Array<{ from: string; to: string; relationType: string }> }): Promise<any> {
    const db = this.ensureDb();
    const insertRelation = db.prepare('INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type) VALUES (?, ?, ?)');

    const created: Relation[] = [];

    for (const rel of args.relations) {
      insertRelation.run(rel.from, rel.to, rel.relationType);
      created.push(rel);
    }

    return { created, count: created.length };
  }

  /**
   * Tool: Add observations
   */
  async memory_add_observations(args: { observations: Array<{ entityName: string; contents: string[] }> }): Promise<any> {
    const db = this.ensureDb();
    const insertObservation = db.prepare('INSERT INTO observations (entity_name, observation) VALUES (?, ?)');

    const added: Array<{ entityName: string; added: string[] }> = [];

    for (const obs of args.observations) {
      for (const content of obs.contents) {
        insertObservation.run(obs.entityName, content);
      }
      added.push({ entityName: obs.entityName, added: obs.contents });
    }

    return { added, count: added.reduce((sum, a) => sum + a.added.length, 0) };
  }

  /**
   * Tool: Delete entities
   */
  async memory_delete_entities(args: { entityNames: string[] }): Promise<any> {
    const db = this.ensureDb();
    const deleteEntity = db.prepare('DELETE FROM entities WHERE name = ?');

    for (const name of args.entityNames) {
      deleteEntity.run(name);
    }

    return { deleted: args.entityNames, count: args.entityNames.length };
  }

  /**
   * Tool: Delete observations
   */
  async memory_delete_observations(args: { deletions: Array<{ entityName: string; contents: string[] }> }): Promise<any> {
    const db = this.ensureDb();
    const deleteObservation = db.prepare('DELETE FROM observations WHERE entity_name = ? AND observation = ?');

    let count = 0;
    for (const del of args.deletions) {
      for (const content of del.contents) {
        const result = deleteObservation.run(del.entityName, content);
        count += result.changes;
      }
    }

    return { deleted: count };
  }

  /**
   * Tool: Delete relations
   */
  async memory_delete_relations(args: { relations: Array<{ from: string; to: string; relationType: string }> }): Promise<any> {
    const db = this.ensureDb();
    const deleteRelation = db.prepare('DELETE FROM relations WHERE from_entity = ? AND to_entity = ? AND relation_type = ?');

    let count = 0;
    for (const rel of args.relations) {
      const result = deleteRelation.run(rel.from, rel.to, rel.relationType);
      count += result.changes;
    }

    return { deleted: count };
  }

  /**
   * Tool: Read the entire graph
   */
  async memory_read_graph(): Promise<any> {
    const db = this.ensureDb();
    
    const entities = db.prepare(`
      SELECT e.name, e.entity_type, GROUP_CONCAT(o.observation, '|||') as observations
      FROM entities e
      LEFT JOIN observations o ON e.name = o.entity_name
      GROUP BY e.name
    `).all() as Array<{ name: string; entity_type: string; observations: string | null }>;

    const relations = db.prepare('SELECT from_entity, to_entity, relation_type FROM relations').all() as Array<{ from_entity: string; to_entity: string; relation_type: string }>;

    return {
      entities: entities.map(e => ({
        name: e.name,
        entityType: e.entity_type,
        observations: e.observations ? e.observations.split('|||') : [],
      })),
      relations: relations.map(r => ({
        from: r.from_entity,
        to: r.to_entity,
        relationType: r.relation_type,
      })),
    };
  }

  /**
   * Tool: Search nodes
   */
  async memory_search_nodes(args: { query: string }): Promise<any> {
    const db = this.ensureDb();
    const searchPattern = `%${args.query}%`;
    
    const entities = db.prepare(`
      SELECT DISTINCT e.name, e.entity_type, GROUP_CONCAT(o.observation, '|||') as observations
      FROM entities e
      LEFT JOIN observations o ON e.name = o.entity_name
      WHERE e.name LIKE ? OR e.entity_type LIKE ? OR o.observation LIKE ?
      GROUP BY e.name
    `).all(searchPattern, searchPattern, searchPattern) as Array<{ name: string; entity_type: string; observations: string | null }>;

    return {
      entities: entities.map(e => ({
        name: e.name,
        entityType: e.entity_type,
        observations: e.observations ? e.observations.split('|||') : [],
      })),
      query: args.query,
    };
  }

  /**
   * Tool: Open specific nodes
   */
  async memory_open_nodes(args: { names: string[] }): Promise<any> {
    const db = this.ensureDb();
    const placeholders = args.names.map(() => '?').join(',');
    
    const entities = db.prepare(`
      SELECT e.name, e.entity_type, GROUP_CONCAT(o.observation, '|||') as observations
      FROM entities e
      LEFT JOIN observations o ON e.name = o.entity_name
      WHERE e.name IN (${placeholders})
      GROUP BY e.name
    `).all(...args.names) as Array<{ name: string; entity_type: string; observations: string | null }>;

    return {
      entities: entities.map(e => ({
        name: e.name,
        entityType: e.entity_type,
        observations: e.observations ? e.observations.split('|||') : [],
      })),
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
