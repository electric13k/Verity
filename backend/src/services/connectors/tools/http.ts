import axios from 'axios';
import { BaseConnector } from '../base';
import { ExecutionContext, ExecutionResult, ConnectorMetadata } from '../../../types/index';

export class HTTPToolConnector extends BaseConnector {
  id = 'http-tool';
  name = 'HTTP Tool';
  type: 'tool' = 'tool';
  description = 'Generic REST API caller';
  metadata: ConnectorMetadata = {
    capabilities: ['rest-api', 'web-services', 'integration']
  };
  costPerCall = 0;

  async validate(input: any): Promise<boolean> {
    return this.validateRequired(input, ['url', 'method']);
  }

  async estimateCost(_input: any): Promise<number> {
    return 0;
  }

  async execute(input: any, _context: ExecutionContext): Promise<ExecutionResult> {
    try {
      const response = await axios({
        url: input.url,
        method: input.method,
        data: input.data,
        params: input.params,
        headers: input.headers,
        timeout: input.timeout || 10000
      });

      return this.success(response.data);
    } catch (error: any) {
      return this.error(error.message);
    }
  }
}
