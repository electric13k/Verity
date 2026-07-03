import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  provider: text('provider').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
});

export const connectors = sqliteTable('connectors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'llm', 'tool', 'data'
  description: text('description'),
  metadata: text('metadata', { mode: 'json' }),
  config: text('config').notNull(), // encrypted JSON
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  costPerCall: real('cost_per_call').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(), // 'pending', 'running', 'completed', 'failed'
  constraints: text('constraints', { mode: 'json' }),
  selectedConnectors: text('selected_connectors', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export const taskExecutions = sqliteTable('task_executions', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  stage: text('stage').notNull(),
  reasoning: text('reasoning', { mode: 'json' }),
  plans: text('plans', { mode: 'json' }),
  selectedPlan: text('selected_plan', { mode: 'json' }),
  intermediateResults: text('intermediate_results', { mode: 'json' }),
  finalResult: text('final_result'),
  totalCost: real('total_cost').default(0),
  executionTime: integer('execution_time'), // in ms
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const executionLogs = sqliteTable('execution_logs', {
  id: text('id').primaryKey(),
  taskExecutionId: text('task_execution_id').notNull().references(() => taskExecutions.id),
  connectorId: text('connector_id').notNull(),
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  error: text('error'),
  duration: integer('duration'),
  costUsed: real('cost_used').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});
