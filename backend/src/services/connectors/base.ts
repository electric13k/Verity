import { 
  ConnectorType, 
  ConnectorMetadata, 
  ConnectorConfig, 
  ExecutionResult, 
  ExecutionContext 
} from '../../types/index';

export abstract class BaseConnector {
  abstract id: string;
  abstract name: string;
  abstract type: ConnectorType;
  abstract description: string;
  abstract metadata: ConnectorMetadata;
  config: ConnectorConfig = {};
  enabled: boolean = true;
  costPerCall: number = 0;

  constructor(config?: ConnectorConfig) {
    if (config) {
      this.config = config;
    }
  }

  abstract validate(input: any): Promise<boolean>;
  abstract estimateCost(input: any): Promise<number>;
  abstract execute(input: any, context: ExecutionContext): Promise<ExecutionResult>;

  protected success(data: any, usage?: ExecutionResult['usage']): ExecutionResult {
    return { success: true, data, usage };
  }

  protected error(message: string): ExecutionResult {
    return { success: false, error: message };
  }

  protected validateRequired(input: any, fields: string[]): boolean {
    for (const field of fields) {
      if (input[field] === undefined || input[field] === null) {
        return false;
      }
    }
    return true;
  }
}
