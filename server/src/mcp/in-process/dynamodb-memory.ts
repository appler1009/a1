/**
 * DynamoDB Memory In-Process MCP Module
 * 
 * This module provides direct in-process access to DynamoDB-based memory storage
 * for knowledge graph operations (entities, relations, observations).
 * 
 * Used when STORAGE_TYPE=s3 (production AWS deployment).
 * Local deployment uses SQLiteMemoryInProcess instead.
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getAwsCredentials } from '../../config/aws.js';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

interface DynamoDBMemoryConfig {
  tablePrefix?: string;
}

interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface EntityFromDb {
  entityName: string;
  entityType: string;
  observations?: Set<string>;
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

export class DynamoDBMemoryInProcess implements InProcessMCPModule {
  static readonly systemPrompt = `## MEMORY SYSTEM
Persistent knowledge graph for continuity across conversations.
- **memory_search_nodes**: Search entities, relationships, and observations by query
- **memory_read_graph**: Read the entire graph for a complete overview
- **memory_open_nodes**: Retrieve specific entities by name

Call memory_search_nodes before answering questions about the user's preferences, past decisions, or prior context — never assume. When the user references a previous topic, look it up rather than relying on in-context recall.`;

  getSystemPromptSummary(): string {
    return 'Memory — persistent knowledge graph for storing and retrieving facts, preferences, and context across conversations.';
  }

  getSystemPrompt(): string {
    return DynamoDBMemoryInProcess.systemPrompt;
  }

  private client: DynamoDBDocumentClient;
  private roleId: string;
  private entitiesTable: string;
  private relationsTable: string;

  [key: string]: unknown;

  constructor(roleId: string, config?: DynamoDBMemoryConfig) {
    this.roleId = roleId;
    
    const tablePrefix = config?.tablePrefix ?? process.env.DYNAMODB_TABLE_PREFIX ?? '';
    this.entitiesTable = `${tablePrefix}memory_entities`;
    this.relationsTable = `${tablePrefix}memory_relations`;
    
    const dbClient = new DynamoDBClient({
      region: process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-west-2',
      ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
      credentials: getAwsCredentials(),
    });
    
    this.client = DynamoDBDocumentClient.from(dbClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
    
    console.log(`[DynamoDBMemoryInProcess] Initialized with roleId: ${roleId}, tables: ${this.entitiesTable}, ${this.relationsTable}`);
  }

  private entityPk(entityName: string): string {
    return `${this.roleId}#${entityName}`;
  }

  private relationPk(from: string, to: string, relationType: string): string {
    return `${this.roleId}#${from}#${to}#${relationType}`;
  }

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

  async memory_create_entities(args: { entities: Array<{ name: string; entityType: string; observations?: string[] }> }): Promise<any> {
    const created: Entity[] = [];

    for (const entity of args.entities) {
      await this.client.send(new PutCommand({
        TableName: this.entitiesTable,
        Item: {
          pk: this.entityPk(entity.name),
          roleId: this.roleId,
          entityName: entity.name,
          entityType: entity.entityType,
          observations: new Set(entity.observations || []),
        },
      }));

      created.push({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations || [],
      });
    }

    return { created, count: created.length };
  }

  async memory_create_relations(args: { relations: Array<{ from: string; to: string; relationType: string }> }): Promise<any> {
    const created: Relation[] = [];

    for (const rel of args.relations) {
      await this.client.send(new PutCommand({
        TableName: this.relationsTable,
        Item: {
          pk: this.relationPk(rel.from, rel.to, rel.relationType),
          roleId: this.roleId,
          from: rel.from,
          to: rel.to,
          relationType: rel.relationType,
        },
      }));

      created.push(rel);
    }

    return { created, count: created.length };
  }

  async memory_add_observations(args: { observations: Array<{ entityName: string; contents: string[] }> }): Promise<any> {
    const added: Array<{ entityName: string; added: string[] }> = [];

    for (const obs of args.observations) {
      if (!obs.contents.length) continue;

      await this.client.send(new UpdateCommand({
        TableName: this.entitiesTable,
        Key: { pk: this.entityPk(obs.entityName) },
        UpdateExpression: 'ADD observations :obs',
        ExpressionAttributeValues: {
          ':obs': new Set(obs.contents),
        },
      }));

      added.push({ entityName: obs.entityName, added: obs.contents });
    }

    return { added, count: added.reduce((sum, a) => sum + a.added.length, 0) };
  }

  async memory_delete_entities(args: { entityNames: string[] }): Promise<any> {
    const deletes = args.entityNames.map(name => ({
      DeleteRequest: {
        Key: { pk: this.entityPk(name) },
      },
    }));

    for (let i = 0; i < deletes.length; i += 25) {
      const batch = deletes.slice(i, i + 25);
      await this.client.send(new BatchWriteCommand({
        RequestItems: {
          [this.entitiesTable]: batch,
        },
      }));
    }

    return { deleted: args.entityNames, count: args.entityNames.length };
  }

  async memory_delete_observations(args: { deletions: Array<{ entityName: string; contents: string[] }> }): Promise<any> {
    let count = 0;

    for (const del of args.deletions) {
      if (!del.contents.length) continue;

      await this.client.send(new UpdateCommand({
        TableName: this.entitiesTable,
        Key: { pk: this.entityPk(del.entityName) },
        UpdateExpression: 'DELETE observations :obs',
        ExpressionAttributeValues: {
          ':obs': new Set(del.contents),
        },
      }));

      count += del.contents.length;
    }

    return { deleted: count };
  }

  async memory_delete_relations(args: { relations: Array<{ from: string; to: string; relationType: string }> }): Promise<any> {
    const deletes = args.relations.map(rel => ({
      DeleteRequest: {
        Key: { pk: this.relationPk(rel.from, rel.to, rel.relationType) },
      },
    }));

    for (let i = 0; i < deletes.length; i += 25) {
      const batch = deletes.slice(i, i + 25);
      await this.client.send(new BatchWriteCommand({
        RequestItems: {
          [this.relationsTable]: batch,
        },
      }));
    }

    return { deleted: args.relations.length };
  }

  async memory_read_graph(): Promise<any> {
    const entities = await this.queryAllEntities();
    const relations = await this.queryAllRelations();

    return {
      entities: entities.map(e => ({
        name: e.entityName,
        entityType: e.entityType,
        observations: e.observations ? Array.from(e.observations) : [],
      })),
      relations: relations.map(r => ({
        from: r.from,
        to: r.to,
        relationType: r.relationType,
      })),
    };
  }

  async memory_search_nodes(args: { query: string }): Promise<any> {
    const entities = await this.queryAllEntities();
    const queryLower = args.query.toLowerCase();

    const filtered = entities.filter(e => {
      if (e.entityName.toLowerCase().includes(queryLower)) return true;
      if (e.entityType.toLowerCase().includes(queryLower)) return true;
      const obsArray = e.observations ? Array.from(e.observations) : [];
      if (obsArray.some(obs => obs.toLowerCase().includes(queryLower))) return true;
      return false;
    });

    return {
      entities: filtered.map(e => ({
        name: e.entityName,
        entityType: e.entityType,
        observations: e.observations ? Array.from(e.observations as Set<string>) : [],
      })),
      query: args.query,
    };
  }

  async memory_open_nodes(args: { names: string[] }): Promise<any> {
    const keys = args.names.map(name => ({ pk: this.entityPk(name) }));
    
    const items: Record<string, unknown>[] = [];
    
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      const response = await this.client.send(new BatchGetCommand({
        RequestItems: {
          [this.entitiesTable]: {
            Keys: batch,
          },
        },
      }));
      items.push(...(response.Responses?.[this.entitiesTable] || []));
    }

    return {
      entities: items.map(e => ({
        name: e.entityName,
        entityType: e.entityType,
        observations: e.observations ? Array.from(e.observations as Set<string>) : [],
      })),
    };
  }

  private async queryAllEntities(): Promise<Array<{ entityName: string; entityType: string; observations?: Set<string> }>> {
    const items: Array<{ entityName: string; entityType: string; observations?: Set<string> }> = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const response = await this.client.send(new QueryCommand({
        TableName: this.entitiesTable,
        IndexName: 'roleId-index',
        KeyConditionExpression: 'roleId = :roleId',
        ExpressionAttributeValues: {
          ':roleId': this.roleId,
        },
        ExclusiveStartKey: lastKey,
      }));

      const rawItems = response.Items || [];
      items.push(...rawItems.map((item: Record<string, unknown>) => ({
        entityName: item.entityName as string,
        entityType: item.entityType as string,
        observations: item.observations as Set<string> | undefined,
      })));
      lastKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  private async queryAllRelations(): Promise<Array<{ from: string; to: string; relationType: string }>> {
    const items: Array<{ from: string; to: string; relationType: string }> = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const response = await this.client.send(new QueryCommand({
        TableName: this.relationsTable,
        IndexName: 'roleId-index',
        KeyConditionExpression: 'roleId = :roleId',
        ExpressionAttributeValues: {
          ':roleId': this.roleId,
        },
        ExclusiveStartKey: lastKey,
      }));

      const rawItems = response.Items || [];
      items.push(...rawItems.map((item: Record<string, unknown>) => ({
        from: item.from as string,
        to: item.to as string,
        relationType: item.relationType as string,
      })));
      lastKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  close(): void {
    // DynamoDB client doesn't need explicit closing
  }
}
