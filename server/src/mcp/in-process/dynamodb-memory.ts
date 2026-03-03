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
import {
  DynamoDBClient,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

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

const ENTITIES_TABLE = 'memory_entities';
const RELATIONS_TABLE = 'memory_relations';

export class DynamoDBMemoryInProcess implements InProcessMCPModule {
  private client: DynamoDBDocumentClient;
  private roleId: string;

  [key: string]: unknown;

  constructor(roleId: string) {
    this.roleId = roleId;
    
    const dbClient = new DynamoDBClient({
      region: process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
    });
    
    this.client = DynamoDBDocumentClient.from(dbClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
    
    console.log(`[DynamoDBMemoryInProcess] Initialized with roleId: ${roleId}`);
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
        TableName: ENTITIES_TABLE,
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
        TableName: RELATIONS_TABLE,
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
        TableName: ENTITIES_TABLE,
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
          [ENTITIES_TABLE]: batch,
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
        TableName: ENTITIES_TABLE,
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
          [RELATIONS_TABLE]: batch,
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
        observations: e.observations ? Array.from(e.observations) : [],
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
          [ENTITIES_TABLE]: {
            Keys: batch,
          },
        },
      }));
      items.push(...(response.Responses?.[ENTITIES_TABLE] || []));
    }

    return {
      entities: items.map(e => ({
        name: e.entityName,
        entityType: e.entityType,
        observations: e.observations ? Array.from(e.observations) : [],
      })),
    };
  }

  private async queryAllEntities(): Promise<Array<{ entityName: string; entityType: string; observations?: Set<string> }>> {
    const items: Array<{ entityName: string; entityType: string; observations?: Set<string> }> = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const response = await this.client.send(new QueryCommand({
        TableName: ENTITIES_TABLE,
        IndexName: 'roleId-index',
        KeyConditionExpression: 'roleId = :roleId',
        ExpressionAttributeValues: {
          ':roleId': this.roleId,
        },
        ExclusiveStartKey: lastKey,
      }));

      items.push(...(response.Items || []));
      lastKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  private async queryAllRelations(): Promise<Array<{ from: string; to: string; relationType: string }>> {
    const items: Array<{ from: string; to: string; relationType: string }> = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const response = await this.client.send(new QueryCommand({
        TableName: RELATIONS_TABLE,
        IndexName: 'roleId-index',
        KeyConditionExpression: 'roleId = :roleId',
        ExpressionAttributeValues: {
          ':roleId': this.roleId,
        },
        ExclusiveStartKey: lastKey,
      }));

      items.push(...(response.Items || []));
      lastKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  close(): void {
    // DynamoDB client doesn't need explicit closing
  }
}
