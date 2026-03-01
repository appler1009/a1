import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  BatchGetCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import type { User, Session, Group, GroupMember, Invitation } from '@local-agent/shared';
import type { IMainDatabase } from './main-db-interface.js';
import type { RoleDefinition, OAuthTokenEntry, SkillRecord, ScheduledJob } from './main-db.js';

// ============================================================
// Table name helpers
// ============================================================

function tableNames(prefix: string) {
  return {
    users: `${prefix}users`,
    sessions: `${prefix}sessions`,
    groups: `${prefix}groups`,
    memberships: `${prefix}memberships`,
    invitations: `${prefix}invitations`,
    roles: `${prefix}roles`,
    oauthTokens: `${prefix}oauth_tokens`,
    mcpServers: `${prefix}mcp_servers`,
    settings: `${prefix}settings`,
    skills: `${prefix}skills`,
    messages: `${prefix}messages`,
    scheduledJobs: `${prefix}scheduled_jobs`,
  };
}

// ============================================================
// Type helpers
// ============================================================

function toUser(item: Record<string, unknown>): User {
  return {
    id: item.userId as string,
    email: item.email as string,
    name: (item.name as string) || undefined,
    accountType: (item.accountType as 'individual' | 'group') || 'individual',
    discordUserId: (item.discordUserId as string) || undefined,
    locale: (item.locale as string) || undefined,
    timezone: (item.timezone as string) || undefined,
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
  };
}

function toSession(item: Record<string, unknown>): Session {
  return {
    id: item.sessionId as string,
    userId: item.userId as string,
    expiresAt: new Date(item.expiresAt as string),
    createdAt: new Date(item.createdAt as string),
  };
}

function toGroup(item: Record<string, unknown>): Group {
  return {
    id: item.groupId as string,
    name: item.name as string,
    url: (item.url as string) || undefined,
    createdAt: new Date(item.createdAt as string),
  };
}

function toGroupMember(item: Record<string, unknown>): GroupMember {
  return {
    id: item.id as string,
    groupId: item.groupId as string,
    userId: item.userId as string,
    role: (item.role as 'owner' | 'admin' | 'member') || 'member',
    createdAt: new Date(item.createdAt as string),
  };
}

function toInvitation(item: Record<string, unknown>): Invitation {
  return {
    id: item.invitationId as string,
    code: item.code as string,
    groupId: item.groupId as string,
    createdBy: item.createdBy as string,
    email: (item.email as string) || undefined,
    role: (item.role as 'owner' | 'admin' | 'member') || 'member',
    expiresAt: item.expiresAt ? new Date(item.expiresAt as string) : undefined,
    usedAt: item.usedAt ? new Date(item.usedAt as string) : undefined,
    acceptedAt: item.acceptedAt ? new Date(item.acceptedAt as string) : undefined,
    createdAt: new Date(item.createdAt as string),
  };
}

function toRole(item: Record<string, unknown>): RoleDefinition {
  return {
    id: item.roleId as string,
    userId: item.userId as string,
    groupId: (item.groupId as string) || null,
    name: item.name as string,
    jobDesc: (item.jobDesc as string) || null,
    systemPrompt: (item.systemPrompt as string) || null,
    model: (item.model as string) || null,
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
  };
}

function toOAuthToken(item: Record<string, unknown>): OAuthTokenEntry {
  const [provider, ...emailParts] = (item.providerKey as string).split('#');
  const accountEmail = emailParts.join('#');
  return {
    provider,
    userId: item.userId as string,
    accountEmail,
    accessToken: item.accessToken as string,
    refreshToken: (item.refreshToken as string) || null,
    expiryDate: (item.expiryDate as number) || null,
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
  };
}

function toSkill(item: Record<string, unknown>): SkillRecord {
  return {
    id: item.skillId as string,
    name: item.name as string,
    description: (item.description as string) || undefined,
    content: item.content as string,
    type: (item.type as string) || 'mcp-in-process',
    config: item.config as Record<string, unknown> | undefined,
    enabled: item.enabled !== false,
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
  };
}

function toScheduledJob(item: Record<string, unknown>): ScheduledJob {
  return {
    id: item.jobId as string,
    userId: item.userId as string,
    roleId: item.roleId as string,
    description: item.description as string,
    scheduleType: item.scheduleType as 'once' | 'recurring',
    runAt: item.runAt ? new Date(item.runAt as string) : null,
    status: item.status as ScheduledJob['status'],
    lastRunAt: item.lastRunAt ? new Date(item.lastRunAt as string) : null,
    lastError: (item.lastError as string) || null,
    holdUntil: item.holdUntil ? new Date(item.holdUntil as string) : null,
    runCount: (item.runCount as number) || 0,
    createdAt: new Date(item.createdAt as string),
    updatedAt: new Date(item.updatedAt as string),
  };
}

function toMessageRow(item: Record<string, unknown>) {
  return {
    id: item.messageId as string,
    userId: item.userId as string,
    roleId: item.roleId as string,
    groupId: (item.groupId as string) || null,
    role: item.role as string,
    content: item.content as string,
    createdAt: item.createdAt as string,
  };
}

// ============================================================
// DynamoDB Main Database
// ============================================================

export class DynamoDBMainDatabase implements IMainDatabase {
  private client: DynamoDBDocumentClient;
  private tables: ReturnType<typeof tableNames>;

  constructor(config: {
    region?: string;
    endpoint?: string;
    tablePrefix?: string;
  } = {}) {
    const dynamo = new DynamoDBClient({
      region: config.region || process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-east-1',
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    this.client = DynamoDBDocumentClient.from(dynamo, {
      marshallOptions: { removeUndefinedValues: true },
    });
    const prefix = config.tablePrefix ?? process.env.DYNAMODB_TABLE_PREFIX ?? '';
    this.tables = tableNames(prefix);
  }

  async initialize(): Promise<void> {
    // DynamoDB tables are provisioned externally (CDK, Terraform, or AWS console).
    // Run a lightweight connectivity check.
    await this.client.send(new ScanCommand({
      TableName: this.tables.settings,
      Limit: 1,
    })).catch(err => {
      if (err.name !== 'ResourceNotFoundException') return; // table exists but might be empty
      throw new Error(
        `[DynamoDBMainDatabase] Table "${this.tables.settings}" not found. ` +
        'Create DynamoDB tables before starting the server.'
      );
    });
  }

  close(): void {
    // No persistent connection to close for DynamoDB HTTP client.
  }

  // ============================================================
  // User Operations
  // ============================================================

  async createUser(email: string, name?: string, accountType: 'individual' | 'group' = 'individual'): Promise<User> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const item: Record<string, unknown> = {
      userId: id,
      email,
      accountType,
      createdAt: now,
      updatedAt: now,
    };
    if (name) item.name = name;

    await this.client.send(new PutCommand({ TableName: this.tables.users, Item: item }));
    return toUser(item);
  }

  async getUser(id: string): Promise<User | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.users,
      Key: { userId: id },
    }));
    return Item ? toUser(Item) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.users,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    }));
    return Items?.[0] ? toUser(Items[0]) : null;
  }

  async getUserByDiscordId(discordUserId: string): Promise<User | null> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.users,
      IndexName: 'discordUserId-index',
      KeyConditionExpression: 'discordUserId = :did',
      ExpressionAttributeValues: { ':did': discordUserId },
      Limit: 1,
    }));
    return Items?.[0] ? toUser(Items[0]) : null;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const now = new Date().toISOString();
    const sets: string[] = ['updatedAt = :updatedAt'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':updatedAt': now };

    if (updates.email !== undefined) { sets.push('#email = :email'); names['#email'] = 'email'; values[':email'] = updates.email; }
    if (updates.name !== undefined) { sets.push('#name = :name'); names['#name'] = 'name'; values[':name'] = updates.name ?? null; }
    if (updates.accountType !== undefined) { sets.push('accountType = :accountType'); values[':accountType'] = updates.accountType; }
    if (updates.discordUserId !== undefined) { sets.push('discordUserId = :discordUserId'); values[':discordUserId'] = updates.discordUserId ?? null; }
    if (updates.locale !== undefined) { sets.push('locale = :locale'); values[':locale'] = updates.locale ?? null; }
    if (updates.timezone !== undefined) { sets.push('timezone = :timezone'); values[':timezone'] = updates.timezone ?? null; }

    const { Attributes } = await this.client.send(new UpdateCommand({
      TableName: this.tables.users,
      Key: { userId: id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(userId)',
      ReturnValues: 'ALL_NEW',
    })).catch(err => {
      if (err.name === 'ConditionalCheckFailedException') return { Attributes: undefined };
      throw err;
    });

    return Attributes ? toUser(Attributes) : null;
  }

  async getAllUsers(): Promise<User[]> {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await this.client.send(new ScanCommand({
        TableName: this.tables.users,
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(resp.Items ?? []));
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.map(toUser);
  }

  async deleteUser(id: string): Promise<boolean> {
    // Delete messages for this user first (no FK cascade in DynamoDB)
    await this._deleteUserMessages(id);

    const { ConsumedCapacity } = await this.client.send(new DeleteCommand({
      TableName: this.tables.users,
      Key: { userId: id },
      ConditionExpression: 'attribute_exists(userId)',
      ReturnConsumedCapacity: 'NONE',
    })).catch(err => {
      if (err.name === 'ConditionalCheckFailedException') return { ConsumedCapacity: undefined };
      throw err;
    });

    // Sessions, roles, oauth_tokens, memberships cascade via TTL/conditional deletes
    // or are cleaned up lazily. For immediate cleanup, delete synchronously:
    await Promise.all([
      this._deleteSessions(id),
      this._deleteRoles(id),
      this._deleteOAuthTokens(id),
      this._deleteMemberships(id),
    ]);

    return true; // We treat deleteUser as always succeeding for existing users
  }

  // ============================================================
  // Session Operations
  // ============================================================

  async createSession(userId: string): Promise<Session> {
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    const item = {
      sessionId: id,
      userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      ttl, // DynamoDB TTL attribute — table must be configured to use 'ttl' as the TTL attribute
    };

    await this.client.send(new PutCommand({ TableName: this.tables.sessions, Item: item }));
    return toSession(item);
  }

  async getSession(id: string): Promise<Session | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.sessions,
      Key: { sessionId: id },
    }));
    if (!Item) return null;

    const session = toSession(Item);
    if (session.expiresAt < new Date()) {
      await this.deleteSession(id);
      return null;
    }
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tables.sessions,
      Key: { sessionId: id },
    }));
  }

  // ============================================================
  // Group Operations
  // ============================================================

  async createGroup(name: string, url?: string): Promise<Group> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const item: Record<string, unknown> = { groupId: id, name, createdAt: now };
    if (url) item.url = url;

    await this.client.send(new PutCommand({ TableName: this.tables.groups, Item: item }));
    return toGroup(item);
  }

  async getGroup(id: string): Promise<Group | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.groups,
      Key: { groupId: id },
    }));
    return Item ? toGroup(Item) : null;
  }

  async getGroupByUrl(url: string): Promise<Group | null> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.groups,
      IndexName: 'url-index',
      KeyConditionExpression: '#url = :url',
      ExpressionAttributeNames: { '#url': 'url' },
      ExpressionAttributeValues: { ':url': url },
      Limit: 1,
    }));
    return Items?.[0] ? toGroup(Items[0]) : null;
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    // 1. Query memberships GSI to get groupIds
    const { Items: memberItems } = await this.client.send(new QueryCommand({
      TableName: this.tables.memberships,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    }));
    if (!memberItems?.length) return [];

    // 2. BatchGet groups
    const keys = memberItems.map(m => ({ groupId: m.groupId }));
    const { Responses } = await this.client.send(new BatchGetCommand({
      RequestItems: { [this.tables.groups]: { Keys: keys } },
    }));
    return (Responses?.[this.tables.groups] ?? []).map(toGroup);
  }

  // ============================================================
  // Membership Operations
  // ============================================================

  async addMember(groupId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<GroupMember> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const item = { groupId, userId, id, role, createdAt: now };
    await this.client.send(new PutCommand({ TableName: this.tables.memberships, Item: item }));
    return toGroupMember(item);
  }

  async getMembership(groupId: string, userId: string): Promise<GroupMember | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.memberships,
      Key: { groupId, userId },
    }));
    return Item ? toGroupMember(Item) : null;
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.memberships,
      KeyConditionExpression: 'groupId = :groupId',
      ExpressionAttributeValues: { ':groupId': groupId },
    }));
    return (Items ?? []).map(toGroupMember);
  }

  async updateMemberRole(groupId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<GroupMember | null> {
    const { Attributes } = await this.client.send(new UpdateCommand({
      TableName: this.tables.memberships,
      Key: { groupId, userId },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': role },
      ConditionExpression: 'attribute_exists(groupId)',
      ReturnValues: 'ALL_NEW',
    })).catch(err => {
      if (err.name === 'ConditionalCheckFailedException') return { Attributes: undefined };
      throw err;
    });
    return Attributes ? toGroupMember(Attributes) : null;
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    const { ConsumedCapacity } = await this.client.send(new DeleteCommand({
      TableName: this.tables.memberships,
      Key: { groupId, userId },
      ConditionExpression: 'attribute_exists(groupId)',
      ReturnConsumedCapacity: 'NONE',
    })).catch(err => {
      if (err.name === 'ConditionalCheckFailedException') return { ConsumedCapacity: undefined };
      throw err;
    });
    return true;
  }

  // ============================================================
  // Invitation Operations
  // ============================================================

  async createInvitation(
    groupId: string,
    createdBy: string,
    email?: string,
    role: 'owner' | 'admin' | 'member' = 'member',
    expiresInSeconds: number = 7 * 24 * 60 * 60
  ): Promise<Invitation> {
    const id = uuidv4();
    const code = this._generateInviteCode();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    const item: Record<string, unknown> = {
      invitationId: id,
      code,
      groupId,
      createdBy,
      role,
      expiresAt: expiresAt.toISOString(),
      createdAt: now,
      ttl,
    };
    if (email) item.email = email;

    await this.client.send(new PutCommand({ TableName: this.tables.invitations, Item: item }));
    return toInvitation(item);
  }

  async getInvitationByCode(code: string): Promise<Invitation | null> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.invitations,
      IndexName: 'code-index',
      KeyConditionExpression: '#code = :code',
      ExpressionAttributeNames: { '#code': 'code' },
      ExpressionAttributeValues: { ':code': code },
      Limit: 1,
    }));
    return Items?.[0] ? toInvitation(Items[0]) : null;
  }

  async getGroupInvitations(groupId: string): Promise<Invitation[]> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.invitations,
      IndexName: 'groupId-index',
      KeyConditionExpression: 'groupId = :groupId',
      FilterExpression: 'attribute_not_exists(usedAt)',
      ExpressionAttributeValues: { ':groupId': groupId },
    }));
    return (Items ?? []).map(toInvitation);
  }

  async acceptInvitation(code: string, userId: string): Promise<GroupMember> {
    const invitation = await this.getInvitationByCode(code);
    if (!invitation) throw new Error('Invitation not found');
    if (invitation.usedAt) throw new Error('Invitation already used');
    if (invitation.expiresAt && invitation.expiresAt < new Date()) throw new Error('Invitation expired');

    const now = new Date().toISOString();
    const memberId = uuidv4();

    // Atomic: mark invitation used + create membership
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: this.tables.invitations,
            Key: { invitationId: invitation.id },
            UpdateExpression: 'SET usedAt = :now, acceptedAt = :now',
            ExpressionAttributeValues: { ':now': now },
          },
        },
        {
          Put: {
            TableName: this.tables.memberships,
            Item: {
              groupId: invitation.groupId,
              userId,
              id: memberId,
              role: invitation.role || 'member',
              createdAt: now,
            },
          },
        },
        {
          Update: {
            TableName: this.tables.users,
            Key: { userId },
            UpdateExpression: 'SET accountType = :type, updatedAt = :now',
            ExpressionAttributeValues: { ':type': 'group', ':now': now },
          },
        },
      ],
    }));

    return {
      id: memberId,
      groupId: invitation.groupId,
      userId,
      role: invitation.role || 'member',
      createdAt: new Date(now),
    };
  }

  async revokeInvitation(invitationId: string): Promise<boolean> {
    await this.client.send(new DeleteCommand({
      TableName: this.tables.invitations,
      Key: { invitationId },
    }));
    return true;
  }

  // ============================================================
  // Role Operations
  // ============================================================

  async createRole(
    userId: string,
    name: string,
    groupId?: string,
    jobDesc?: string,
    systemPrompt?: string,
    model?: string
  ): Promise<RoleDefinition> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const item: Record<string, unknown> = { roleId: id, userId, name, createdAt: now, updatedAt: now };
    if (groupId) item.groupId = groupId;
    if (jobDesc) item.jobDesc = jobDesc;
    if (systemPrompt) item.systemPrompt = systemPrompt;
    if (model) item.model = model;

    await this.client.send(new PutCommand({ TableName: this.tables.roles, Item: item }));
    return toRole(item);
  }

  async getRole(id: string): Promise<RoleDefinition | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.roles,
      Key: { roleId: id },
    }));
    return Item ? toRole(Item) : null;
  }

  async getUserRoles(userId: string): Promise<RoleDefinition[]> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.roles,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    }));
    return (Items ?? []).map(toRole);
  }

  async getGroupRoles(groupId: string): Promise<RoleDefinition[]> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.roles,
      IndexName: 'groupId-index',
      KeyConditionExpression: 'groupId = :groupId',
      ExpressionAttributeValues: { ':groupId': groupId },
    }));
    return (Items ?? []).map(toRole);
  }

  async updateRole(id: string, updates: Partial<Omit<RoleDefinition, 'id' | 'userId' | 'createdAt'>>): Promise<RoleDefinition | null> {
    const now = new Date().toISOString();
    const sets: string[] = ['updatedAt = :updatedAt'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':updatedAt': now };

    if (updates.name !== undefined) { sets.push('#name = :name'); names['#name'] = 'name'; values[':name'] = updates.name; }
    if (updates.groupId !== undefined) { sets.push('groupId = :groupId'); values[':groupId'] = updates.groupId ?? null; }
    if (updates.jobDesc !== undefined) { sets.push('jobDesc = :jobDesc'); values[':jobDesc'] = updates.jobDesc ?? null; }
    if (updates.systemPrompt !== undefined) { sets.push('systemPrompt = :systemPrompt'); values[':systemPrompt'] = updates.systemPrompt ?? null; }
    if (updates.model !== undefined) { sets.push('#model = :model'); names['#model'] = 'model'; values[':model'] = updates.model ?? null; }

    const { Attributes } = await this.client.send(new UpdateCommand({
      TableName: this.tables.roles,
      Key: { roleId: id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ...(Object.keys(names).length > 0 ? { ExpressionAttributeNames: names } : {}),
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(roleId)',
      ReturnValues: 'ALL_NEW',
    })).catch(err => {
      if (err.name === 'ConditionalCheckFailedException') return { Attributes: undefined };
      throw err;
    });

    return Attributes ? toRole(Attributes) : null;
  }

  async deleteRole(id: string): Promise<boolean> {
    await this.client.send(new DeleteCommand({
      TableName: this.tables.roles,
      Key: { roleId: id },
    }));
    return true;
  }

  // ============================================================
  // OAuth Token Operations
  // ============================================================

  async storeOAuthToken(
    userId: string,
    provider: string,
    accessToken: string,
    refreshToken?: string,
    expiryDate?: number,
    accountEmail: string = ''
  ): Promise<OAuthTokenEntry> {
    const providerKey = `${provider}#${accountEmail}`;
    const now = new Date().toISOString();

    // Preserve createdAt if item exists
    const existing = await this.getOAuthToken(userId, provider, accountEmail);

    const item: Record<string, unknown> = {
      userId,
      providerKey,
      provider,
      accountEmail,
      accessToken,
      createdAt: existing?.createdAt.toISOString() ?? now,
      updatedAt: now,
    };
    if (refreshToken) item.refreshToken = refreshToken;
    if (expiryDate !== undefined) item.expiryDate = expiryDate;

    await this.client.send(new PutCommand({ TableName: this.tables.oauthTokens, Item: item }));
    return toOAuthToken(item);
  }

  async getOAuthToken(userId: string, provider: string, accountEmail?: string): Promise<OAuthTokenEntry | null> {
    const providerKey = `${provider}#${accountEmail ?? ''}`;

    if (accountEmail !== undefined) {
      const { Item } = await this.client.send(new GetCommand({
        TableName: this.tables.oauthTokens,
        Key: { userId, providerKey },
      }));
      return Item ? toOAuthToken(Item) : null;
    }

    // No accountEmail — return first match for this provider
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.oauthTokens,
      KeyConditionExpression: 'userId = :userId AND begins_with(providerKey, :prefix)',
      ExpressionAttributeValues: { ':userId': userId, ':prefix': `${provider}#` },
      Limit: 1,
    }));
    return Items?.[0] ? toOAuthToken(Items[0]) : null;
  }

  async getAllUserOAuthTokens(userId: string, provider: string): Promise<OAuthTokenEntry[]> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.oauthTokens,
      KeyConditionExpression: 'userId = :userId AND begins_with(providerKey, :prefix)',
      ExpressionAttributeValues: { ':userId': userId, ':prefix': `${provider}#` },
    }));
    return (Items ?? []).map(toOAuthToken);
  }

  async getOAuthTokenByAccountEmail(provider: string, accountEmail: string): Promise<OAuthTokenEntry | null> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.oauthTokens,
      IndexName: 'accountEmail-index',
      KeyConditionExpression: '#provider = :provider AND accountEmail = :email',
      ExpressionAttributeNames: { '#provider': 'provider' },
      ExpressionAttributeValues: { ':provider': provider, ':email': accountEmail },
      Limit: 1,
    }));
    return Items?.[0] ? toOAuthToken(Items[0]) : null;
  }

  async revokeOAuthToken(userId: string, provider: string, accountEmail?: string): Promise<boolean> {
    if (accountEmail !== undefined) {
      const providerKey = `${provider}#${accountEmail}`;
      await this.client.send(new DeleteCommand({
        TableName: this.tables.oauthTokens,
        Key: { userId, providerKey },
      }));
      return true;
    }

    // Delete all tokens for this provider
    const tokens = await this.getAllUserOAuthTokens(userId, provider);
    await Promise.all(tokens.map(t =>
      this.client.send(new DeleteCommand({
        TableName: this.tables.oauthTokens,
        Key: { userId, providerKey: `${t.provider}#${t.accountEmail}` },
      }))
    ));
    return tokens.length > 0;
  }

  // ============================================================
  // MCP Server Operations
  // ============================================================

  async saveMCPServerConfig(serverId: string, config: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    await this.client.send(new PutCommand({
      TableName: this.tables.mcpServers,
      Item: { serverId, config, createdAt: now, updatedAt: now },
    }));
  }

  async getMCPServerConfigs(): Promise<Array<{ id: string; config: Record<string, unknown> }>> {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await this.client.send(new ScanCommand({
        TableName: this.tables.mcpServers,
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(resp.Items ?? []));
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.map(item => ({ id: item.serverId as string, config: item.config as Record<string, unknown> }));
  }

  async getMCPServerConfig(serverId: string): Promise<Record<string, unknown> | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.mcpServers,
      Key: { serverId },
    }));
    return Item ? (Item.config as Record<string, unknown>) : null;
  }

  async deleteMCPServerConfig(serverId: string): Promise<boolean> {
    await this.client.send(new DeleteCommand({
      TableName: this.tables.mcpServers,
      Key: { serverId },
    }));
    return true;
  }

  // ============================================================
  // Message Operations
  //
  // PK = userId#roleId (roleKey)
  // SK = createdAt#messageId (sortKey) — allows time-range cursor pagination
  // ============================================================

  async saveMessage(entry: {
    id: string;
    userId: string;
    roleId: string;
    groupId: string | null;
    role: string;
    content: string;
    createdAt: string | Date;
  }): Promise<void> {
    const createdAt = entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt;
    const item: Record<string, unknown> = {
      roleKey: `${entry.userId}#${entry.roleId}`,
      sortKey: `${createdAt}#${entry.id}`,
      messageId: entry.id,
      userId: entry.userId,
      roleId: entry.roleId,
      role: entry.role,
      content: entry.content,
      createdAt,
    };
    if (entry.groupId) item.groupId = entry.groupId;

    await this.client.send(new PutCommand({
      TableName: this.tables.messages,
      ConditionExpression: 'attribute_not_exists(roleKey)', // INSERT OR IGNORE equivalent
      Item: item,
    })).catch(err => {
      if (err.name === 'ConditionalCheckFailedException') return; // already exists, ignore
      throw err;
    });
  }

  async listMessages(
    userId: string,
    roleId: string,
    options: { limit?: number; before?: string } = {}
  ) {
    const limit = options.limit ?? 50;
    const roleKey = `${userId}#${roleId}`;

    const params: QueryCommandInput = {
      TableName: this.tables.messages,
      KeyConditionExpression: options.before
        ? 'roleKey = :rk AND sortKey < :before'
        : 'roleKey = :rk',
      ExpressionAttributeValues: options.before
        ? { ':rk': roleKey, ':before': options.before }
        : { ':rk': roleKey },
      ScanIndexForward: false, // DESC
      Limit: limit,
    };

    const { Items } = await this.client.send(new QueryCommand(params));
    // Return in ascending order (oldest first)
    return (Items ?? []).map(toMessageRow).reverse();
  }

  async searchMessages(
    userId: string,
    roleId: string,
    keyword: string,
    options: { limit?: number } = {}
  ) {
    const limit = options.limit ?? 100;
    const roleKey = `${userId}#${roleId}`;

    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.messages,
      KeyConditionExpression: 'roleKey = :rk',
      FilterExpression: 'contains(content, :keyword)',
      ExpressionAttributeValues: { ':rk': roleKey, ':keyword': keyword },
      ScanIndexForward: false,
      Limit: limit,
    }));

    return (Items ?? []).map(toMessageRow);
  }

  async clearMessages(userId: string, roleId: string): Promise<void> {
    const roleKey = `${userId}#${roleId}`;
    let lastKey: Record<string, unknown> | undefined;

    do {
      const { Items, LastEvaluatedKey } = await this.client.send(new QueryCommand({
        TableName: this.tables.messages,
        KeyConditionExpression: 'roleKey = :rk',
        ExpressionAttributeValues: { ':rk': roleKey },
        ProjectionExpression: 'roleKey, sortKey',
        ExclusiveStartKey: lastKey,
      }));

      if (Items?.length) {
        // Delete in batches (TransactWrite supports up to 25 items)
        for (let i = 0; i < Items.length; i += 25) {
          const batch = Items.slice(i, i + 25);
          await this.client.send(new TransactWriteCommand({
            TransactItems: batch.map(item => ({
              Delete: { TableName: this.tables.messages, Key: { roleKey: item.roleKey, sortKey: item.sortKey } },
            })),
          }));
        }
      }

      lastKey = LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
  }

  // ============================================================
  // Settings Operations
  // ============================================================

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.settings,
      Key: { settingKey: key },
    }));
    if (!Item) return null;
    try {
      return JSON.parse(Item.value as string) as T;
    } catch {
      return Item.value as unknown as T;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    await this.client.send(new PutCommand({
      TableName: this.tables.settings,
      Item: { settingKey: key, value: JSON.stringify(value), updatedAt: now },
    }));
  }

  async deleteSetting(key: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tables.settings,
      Key: { settingKey: key },
    }));
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await this.client.send(new ScanCommand({
        TableName: this.tables.settings,
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(resp.Items ?? []));
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    const result: Record<string, unknown> = {};
    for (const item of items) {
      try {
        result[item.settingKey as string] = JSON.parse(item.value as string);
      } catch {
        result[item.settingKey as string] = item.value;
      }
    }
    return result;
  }

  // ============================================================
  // Skills Operations
  // ============================================================

  async upsertSkill(skill: {
    id: string;
    name: string;
    description?: string;
    content: string;
    type?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }): Promise<void> {
    const now = new Date().toISOString();

    // Preserve createdAt if the skill already exists
    const existing = await this.getSkill(skill.id);

    const item: Record<string, unknown> = {
      skillId: skill.id,
      name: skill.name,
      content: skill.content,
      type: skill.type ?? 'mcp-in-process',
      enabled: skill.enabled !== false,
      createdAt: existing?.createdAt.toISOString() ?? now,
      updatedAt: now,
    };
    if (skill.description) item.description = skill.description;
    if (skill.config) item.config = skill.config;

    await this.client.send(new PutCommand({ TableName: this.tables.skills, Item: item }));
  }

  async getSkill(id: string): Promise<SkillRecord | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.skills,
      Key: { skillId: id },
    }));
    return Item ? toSkill(Item) : null;
  }

  async listSkills(enabledOnly = false): Promise<SkillRecord[]> {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const params: ScanCommandInput = {
        TableName: this.tables.skills,
        ExclusiveStartKey: lastKey,
        ...(enabledOnly ? {
          FilterExpression: '#enabled = :true',
          ExpressionAttributeNames: { '#enabled': 'enabled' },
          ExpressionAttributeValues: { ':true': true },
        } : {}),
      };
      const resp = await this.client.send(new ScanCommand(params));
      items.push(...(resp.Items ?? []));
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items.map(toSkill).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ============================================================
  // Scheduled Job Operations
  //
  // GSI 1: userId-status-index  PK=userId, SK=status  → listScheduledJobs
  // GSI 2: typeStatus-runAt-index  PK=typeStatus, SK=runAt → getDueOnceJobs
  // GSI 3: typeStatus-holdUntil-index  PK=typeStatus, SK=holdUntil → getPendingRecurringJobs (optional; Scan+filter also works for small tables)
  // ============================================================

  async createScheduledJob(params: {
    userId: string;
    roleId: string;
    description: string;
    scheduleType: 'once' | 'recurring';
    runAt?: Date | null;
  }): Promise<ScheduledJob> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const item: Record<string, unknown> = {
      jobId: id,
      userId: params.userId,
      roleId: params.roleId,
      description: params.description,
      scheduleType: params.scheduleType,
      status: 'pending',
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      // Composite keys for GSIs
      typeStatus: `${params.scheduleType}#pending`,
    };
    if (params.runAt) item.runAt = params.runAt.toISOString();

    await this.client.send(new PutCommand({ TableName: this.tables.scheduledJobs, Item: item }));
    return toScheduledJob(item);
  }

  async getScheduledJob(id: string): Promise<ScheduledJob | null> {
    const { Item } = await this.client.send(new GetCommand({
      TableName: this.tables.scheduledJobs,
      Key: { jobId: id },
    }));
    return Item ? toScheduledJob(Item) : null;
  }

  async listScheduledJobs(userId: string, opts?: { status?: string; roleId?: string }): Promise<ScheduledJob[]> {
    const params: QueryCommandInput = {
      TableName: this.tables.scheduledJobs,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    };

    const filters: string[] = [];
    if (opts?.status) {
      params.ExpressionAttributeValues![':status'] = opts.status;
      filters.push('#status = :status');
      params.ExpressionAttributeNames = { '#status': 'status' };
    }
    if (opts?.roleId) {
      params.ExpressionAttributeValues![':roleId'] = opts.roleId;
      filters.push('roleId = :roleId');
    }
    if (filters.length > 0) params.FilterExpression = filters.join(' AND ');

    const { Items } = await this.client.send(new QueryCommand(params));
    return (Items ?? []).map(toScheduledJob).sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async getDueOnceJobs(): Promise<ScheduledJob[]> {
    const now = new Date().toISOString();
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.scheduledJobs,
      IndexName: 'typeStatus-runAt-index',
      KeyConditionExpression: 'typeStatus = :ts AND runAt <= :now',
      ExpressionAttributeValues: { ':ts': 'once#pending', ':now': now },
    }));
    return (Items ?? []).map(toScheduledJob);
  }

  async getPendingRecurringJobs(userId?: string): Promise<ScheduledJob[]> {
    const now = new Date().toISOString();
    const params: QueryCommandInput = {
      TableName: this.tables.scheduledJobs,
      IndexName: 'typeStatus-holdUntil-index',
      KeyConditionExpression: 'typeStatus = :ts',
      FilterExpression: 'attribute_not_exists(holdUntil) OR holdUntil <= :now',
      ExpressionAttributeValues: { ':ts': 'recurring#pending', ':now': now },
    };

    if (userId) {
      params.FilterExpression = 'userId = :userId';
      params.ExpressionAttributeValues![':userId'] = userId;
    }

    const { Items } = await this.client.send(new QueryCommand(params)).catch(async () => {
      // Fallback: Scan if GSI not yet available
      return this.client.send(new ScanCommand({
        TableName: this.tables.scheduledJobs,
        FilterExpression: [
          'scheduleType = :recurring',
          '#status = :pending',
          '(attribute_not_exists(holdUntil) OR holdUntil <= :now)',
          ...(userId ? ['userId = :userId'] : []),
        ].join(' AND '),
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':recurring': 'recurring',
          ':pending': 'pending',
          ':now': now,
          ...(userId ? { ':userId': userId } : {}),
        },
      }));
    });

    return (Items ?? []).map(toScheduledJob);
  }

  async updateScheduledJobStatus(id: string, update: {
    status?: ScheduledJob['status'];
    lastRunAt?: Date;
    lastError?: string;
    holdUntil?: Date | null;
    runCount?: number;
  }): Promise<void> {
    const now = new Date().toISOString();
    const sets: string[] = ['updatedAt = :updatedAt'];
    const names: Record<string, string> = { '#status': 'status' };
    const values: Record<string, unknown> = { ':updatedAt': now };

    if (update.status !== undefined) {
      sets.push('#status = :status');
      values[':status'] = update.status;
      // Keep GSI composite key in sync
      sets.push('typeStatus = :typeStatus');
    }
    if (update.lastRunAt !== undefined) { sets.push('lastRunAt = :lastRunAt'); values[':lastRunAt'] = update.lastRunAt.toISOString(); }
    if (update.lastError !== undefined) { sets.push('lastError = :lastError'); values[':lastError'] = update.lastError; }
    if ('holdUntil' in update) {
      if (update.holdUntil) { sets.push('holdUntil = :holdUntil'); values[':holdUntil'] = update.holdUntil.toISOString(); }
      else { sets.push('holdUntil = :holdUntil'); values[':holdUntil'] = null; }
    }
    if (update.runCount !== undefined) { sets.push('runCount = :runCount'); values[':runCount'] = update.runCount; }

    // Resolve typeStatus — need current scheduleType if status is changing
    if (update.status !== undefined) {
      const job = await this.getScheduledJob(id);
      values[':typeStatus'] = `${job?.scheduleType ?? 'once'}#${update.status}`;
    }

    await this.client.send(new UpdateCommand({
      TableName: this.tables.scheduledJobs,
      Key: { jobId: id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  }

  async cancelScheduledJob(id: string, userId: string): Promise<boolean> {
    const { Attributes } = await this.client.send(new UpdateCommand({
      TableName: this.tables.scheduledJobs,
      Key: { jobId: id },
      UpdateExpression: 'SET #status = :cancelled, typeStatus = :ts, updatedAt = :now',
      ConditionExpression: 'userId = :userId AND #status IN (:pending, :failed)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':cancelled': 'cancelled',
        ':ts': 'once#cancelled', // will be overwritten for recurring by next status update
        ':now': new Date().toISOString(),
        ':userId': userId,
        ':pending': 'pending',
        ':failed': 'failed',
      },
      ReturnValues: 'ALL_NEW',
    })).catch(err => {
      if (err.name === 'ConditionalCheckFailedException') return { Attributes: undefined };
      throw err;
    });
    return !!Attributes;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private _generateInviteCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
  }

  private async _deleteUserMessages(userId: string): Promise<void> {
    // Messages PK is userId#roleId — we need to scan for the user's messages
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const resp = await this.client.send(new ScanCommand({
        TableName: this.tables.messages,
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: 'roleKey, sortKey',
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(resp.Items ?? []));
      lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      if (batch.length > 0) {
        await this.client.send(new TransactWriteCommand({
          TransactItems: batch.map(item => ({
            Delete: { TableName: this.tables.messages, Key: { roleKey: item.roleKey, sortKey: item.sortKey } },
          })),
        }));
      }
    }
  }

  private async _deleteSessions(userId: string): Promise<void> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.sessions,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ProjectionExpression: 'sessionId',
    }));
    await Promise.all((Items ?? []).map(item =>
      this.client.send(new DeleteCommand({ TableName: this.tables.sessions, Key: { sessionId: item.sessionId } }))
    ));
  }

  private async _deleteRoles(userId: string): Promise<void> {
    const roles = await this.getUserRoles(userId);
    await Promise.all(roles.map(r =>
      this.client.send(new DeleteCommand({ TableName: this.tables.roles, Key: { roleId: r.id } }))
    ));
  }

  private async _deleteOAuthTokens(userId: string): Promise<void> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.oauthTokens,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ProjectionExpression: 'userId, providerKey',
    }));
    await Promise.all((Items ?? []).map(item =>
      this.client.send(new DeleteCommand({ TableName: this.tables.oauthTokens, Key: { userId: item.userId, providerKey: item.providerKey } }))
    ));
  }

  private async _deleteMemberships(userId: string): Promise<void> {
    const { Items } = await this.client.send(new QueryCommand({
      TableName: this.tables.memberships,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ProjectionExpression: 'groupId, userId',
    }));
    await Promise.all((Items ?? []).map(item =>
      this.client.send(new DeleteCommand({ TableName: this.tables.memberships, Key: { groupId: item.groupId, userId: item.userId } }))
    ));
  }
}

// ============================================================
// Factory / singleton
// ============================================================

let dynamoDb: DynamoDBMainDatabase | null = null;

export function getDynamoDBMainDatabase(config?: {
  region?: string;
  endpoint?: string;
  tablePrefix?: string;
}): DynamoDBMainDatabase {
  if (!dynamoDb) {
    dynamoDb = new DynamoDBMainDatabase(config);
  }
  return dynamoDb;
}
