import { logger } from '../../utils/logger';
import { ConnectorRegistry } from '../connectors/registry';

export interface Skill {
  id: string;
  name: string;
  description: string;
  steps: string[];
  requiredConnectors: string[];
}

export class SkillService {
  private static instance: SkillService;
  private skills: Map<string, Skill> = new Map();
  private registry = ConnectorRegistry.getInstance();

  private constructor() {
    // Register some default skills
    this.registerDefaultSkills();
  }

  public static getInstance(): SkillService {
    if (!SkillService.instance) {
      SkillService.instance = new SkillService();
    }
    return SkillService.instance;
  }

  private registerDefaultSkills() {
    const defaultSkills: Skill[] = [
      {
        id: 'web-researcher',
        name: 'Web Researcher',
        description: 'Searches the web and summarizes findings using LLMs',
        steps: ['Search Web', 'Fetch Content', 'Summarize'],
        requiredConnectors: ['web-fetch', 'openai']
      },
      {
        id: 'system-analyzer',
        name: 'System Analyzer',
        description: 'Analyzes system performance and file structure',
        steps: ['Get System Info', 'Read Files', 'Generate Report'],
        requiredConnectors: ['system-info', 'file-read', 'claude']
      }
    ];

    defaultSkills.forEach(skill => this.skills.set(skill.id, skill));
  }

  public getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  public getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  public async executeSkill(id: string, input: string): Promise<string> {
    const skill = this.getSkill(id);
    if (!skill) throw new Error(`Skill ${id} not found`);

    logger.info(`Executing skill: ${skill.name} with input: ${input}`);
    
    // Check if required connectors are enabled
    for (const connectorId of skill.requiredConnectors) {
      const connector = this.registry.get(connectorId);
      if (!connector || !connector.enabled) {
        throw new Error(`Required connector ${connectorId} is not enabled for skill ${skill.name}`);
      }
    }

    // Logic for sequential execution would go here
    return `Skill ${skill.name} executed successfully for: ${input}`;
  }
}
