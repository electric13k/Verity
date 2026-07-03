import axios from 'axios';
import { BaseConnector } from '../base';
import { ExecutionContext, ExecutionResult, ConnectorMetadata } from '../../../types/index';

export class WebFetchConnector extends BaseConnector {
  id = 'web-fetch';
  name = 'Web Fetcher';
  type: 'data' = 'data';
  description = 'Fetches and cleans web content';
  metadata: ConnectorMetadata = {
    capabilities: ['web-scraping', 'content-extraction', 'data-collection']
  };
  costPerCall = 0;

  async validate(input: any): Promise<boolean> {
    return this.validateRequired(input, ['url']);
  }

  async estimateCost(_input: any): Promise<number> {
    return 0;
  }

  async execute(input: any, _context: ExecutionContext): Promise<ExecutionResult> {
    try {
      const response = await axios.get(input.url, {
        headers: {
          'User-Agent': 'AI-Orchestrator/1.0'
        },
        timeout: 15000
      });

      const html = response.data;
      if (typeof html !== 'string') {
        return this.success(html);
      }

      // Basic HTML stripping
      const cleanText = html
        .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gmi, '')
        .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gmi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return this.success({
        url: input.url,
        title: html.match(/<title>(.*?)<\/title>/)?.[1] || '',
        content: cleanText.substring(0, 10000) // Limit content size
      });
    } catch (error: any) {
      return this.error(error.message);
    }
  }
}
