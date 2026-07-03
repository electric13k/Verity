export interface User {
  id: string;
  email: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  steps: string[];
  requiredConnectors: string[];
}

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Connector {
  id: string;
  name: string;
  type: 'llm' | 'tool' | 'data';
  description: string;
  metadata: {
    capabilities: string[];
    model?: string;
    baseUrl?: string;
  };
  enabled: boolean;
  costPerCall: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface ExecutionResult {
  status: string;
  reasoning: {
    objective: string;
    successCriteria: string[];
    complexity: string;
    capabilities: string[];
  };
  plans: any[];
  selectedPlan: any;
  tumlChecks: any[];
  intermediateResults: any[];
  finalResult: string;
  totalCost: number;
  executionTime: number;
}
