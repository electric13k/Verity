import axios from 'axios';
import { BaseConnector } from '../base';
import { ExecutionContext, ExecutionResult, ConnectorMetadata } from '../../../types/index';

export class OllamaConnector extends BaseConnector {
  id = 'ollama';
  name = 'Ollama (Local)';
  type: 'llm' = 'llm';
  description = 'Local LLM orchestration via Ollama';
  metadata: ConnectorMetadata = {
    capabilities: ['offline', 'privacy', 'local-execution'],
    model: 'llama2'
  };
  costPerCall = 0;

  async validate(input: any): Promise<boolean> {
    return this.validateRequired(input, ['messages']);
  }

  async estimateCost(_input: any): Promise<number> {
    return 0;
  }

  async execute(input: any, _context: ExecutionContext): Promise<ExecutionResult> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    try {
      const response = await axios.post(
        `${baseUrl}/api/chat`,
        {
          model: this.metadata.model,
          messages: input.messages,
          stream: false
        }
      );

      const data = response.data;
      return this.success(data.message.content, {
        totalTokens: 0, // Ollama doesn't always provide tokens in a standard way
        cost: 0
      });
    } catch (error: any) {
      return this.error(`Ollama error: ${error.message}. Make sure Ollama is running.`);
    }
  }
}
