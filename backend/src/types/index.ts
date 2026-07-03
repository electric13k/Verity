export type ConnectorType = 'llm' | 'tool' | 'data';

export interface ConnectorMetadata {
  capabilities: string[];
  model?: string;
  baseUrl?: string;
}

export interface ConnectorConfig {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: any;
}

export interface ExecutionContext {
  userId: string;
  taskId: string;
  executionId: string;
}

export interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number;
  };
}

export interface HAISBContext {
  objective: string;
  successCriteria: string[];
  credentials: string[];
  capabilities: string[];
  complexity: 'simple' | 'medium' | 'complex';
  requirements: string[];
  protocol: string;
  isValid: boolean;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  steps: string[];
  connectorIds: string[];
  estimatedCost: number;
  estimatedLatency: number;
  riskLevel: 'low' | 'medium' | 'high';
  score: number;
}

export interface TUMLCheck {
  id: string;
  name: string;
  passed: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message?: string;
  autoCorrection?: string;
  userAction?: string;
}

export interface User {
  id: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: User;
}
