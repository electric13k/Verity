import { HAISBContext } from '../../types/index';
import { ConnectorRegistry } from '../connectors/registry';

export class HAISB {
  private static registry = ConnectorRegistry.getInstance();

  public static async process(description: string): Promise<HAISBContext> {
    const objective = this.extractObjective(description);
    const successCriteria = this.defineSuccessCriteria(description);
    const credentials = this.checkCredentials();
    const capabilities = this.collectCapabilities();
    const complexity = this.estimateComplexity(description);
    const requirements = this.detectRequirements(description);
    const protocol = this.buildActionProtocol(capabilities);
    const isValid = this.validate(description, credentials);

    return {
      objective,
      successCriteria,
      credentials,
      capabilities,
      complexity,
      requirements,
      protocol,
      isValid
    };
  }

  private static extractObjective(desc: string): string {
    return desc.split('.')[0] || desc;
  }

  private static defineSuccessCriteria(desc: string): string[] {
    const criteria = [];
    if (desc.includes('summarize')) criteria.push('Concise summary provided');
    if (desc.includes('analyze')) criteria.push('In-depth analysis included');
    if (desc.includes('code')) criteria.push('Working code snippets provided');
    if (criteria.length === 0) criteria.push('Informative response delivered');
    return criteria;
  }

  private static checkCredentials(): string[] {
    return this.registry.listEnabled().map(c => c.id);
  }

  private static collectCapabilities(): string[] {
    const caps = new Set<string>();
    this.registry.listEnabled().forEach(c => {
      c.metadata.capabilities.forEach(cap => caps.add(cap));
    });
    return Array.from(caps);
  }

  private static estimateComplexity(desc: string): 'simple' | 'medium' | 'complex' {
    const wordCount = desc.split(' ').length;
    if (wordCount > 100 || desc.includes('complex') || desc.includes('system')) return 'complex';
    if (wordCount > 30) return 'medium';
    return 'simple';
  }

  private static detectRequirements(desc: string): string[] {
    const reqs = [];
    if (desc.includes('http') || desc.includes('api')) reqs.push('rest-api');
    if (desc.includes('file') || desc.includes('read')) reqs.push('file-system');
    if (desc.includes('system') || desc.includes('os')) reqs.push('hardware-info');
    return reqs;
  }

  private static buildActionProtocol(capabilities: string[]): string {
    if (capabilities.includes('reasoning')) return 'sequential-reasoning';
    return 'direct-execution';
  }

  private static validate(desc: string, credentials: string[]): boolean {
    return desc.length > 5 && credentials.length > 0;
  }
}
