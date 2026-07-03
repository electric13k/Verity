import axios from 'axios';
import { BaseConnector } from '../base';
import { ExecutionContext, ExecutionResult, ConnectorMetadata } from '../../../types/index';

export class OpenAIConnector extends BaseConnector {
  id = 'openai';
  name = 'OpenAI GPT-4';
  type: 'llm' = 'llm';
  description = 'GPT-4 Turbo by OpenAI';
  metadata: ConnectorMetadata = {
    capabilities: ['reasoning', 'coding', 'general-purpose'],
    model: 'gpt-4-turbo'
  };
  costPerCall = 0.01;

  async validate(input: any): Promise<boolean> {
    return this.validateRequired(input, ['messages']);
  }

  async estimateCost(_input: any): Promise<number> {
    return this.costPerCall;
  }

  async execute(input: any, _context: ExecutionContext): Promise<ExecutionResult> {
    if (!this.config.apiKey) return this.error('OpenAI API key not configured');

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: this.metadata.model,
          messages: input.messages,
          max_tokens: input.max_tokens || 4096
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = response.data;
      return this.success(data.choices[0].message.content, {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
        cost: this.costPerCall
      });
    } catch (error: any) {
      return this.error(error.response?.data?.error?.message || error.message);
    }
  }
}
