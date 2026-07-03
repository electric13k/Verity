import axios from 'axios';
import { BaseConnector } from '../base';
import { ExecutionContext, ExecutionResult, ConnectorMetadata } from '../../../types/index';

export class ClaudeConnector extends BaseConnector {
  id = 'claude';
  name = 'Anthropic Claude';
  type: 'llm' = 'llm';
  description = 'Claude 3.5 Sonnet by Anthropic';
  metadata: ConnectorMetadata = {
    capabilities: ['reasoning', 'coding', 'analysis', 'long-context'],
    model: 'claude-3-5-sonnet-20241022'
  };
  costPerCall = 0.015;

  async validate(input: any): Promise<boolean> {
    return this.validateRequired(input, ['messages']);
  }

  async estimateCost(_input: any): Promise<number> {
    return this.costPerCall;
  }

  async execute(input: any, _context: ExecutionContext): Promise<ExecutionResult> {
    if (!this.config.apiKey) return this.error('Claude API key not configured');

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: this.metadata.model,
          messages: input.messages,
          max_tokens: input.max_tokens || 4096,
          system: input.system
        },
        {
          headers: {
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      const data = response.data;
      return this.success(data.content[0].text, {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        cost: this.costPerCall
      });
    } catch (error: any) {
      return this.error(error.response?.data?.error?.message || error.message);
    }
  }
}
