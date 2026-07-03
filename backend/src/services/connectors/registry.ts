import { BaseConnector } from './base';
import { ConnectorType } from '../../types/index';

export class ConnectorRegistry {
  private static instance: ConnectorRegistry;
  private connectors: Map<string, BaseConnector> = new Map();

  private constructor() {}

  public static getInstance(): ConnectorRegistry {
    if (!ConnectorRegistry.instance) {
      ConnectorRegistry.instance = new ConnectorRegistry();
    }
    return ConnectorRegistry.instance;
  }

  public register(connector: BaseConnector): void {
    this.connectors.set(connector.id, connector);
  }

  public get(id: string): BaseConnector | undefined {
    return this.connectors.get(id);
  }

  public list(type?: ConnectorType): BaseConnector[] {
    const all = Array.from(this.connectors.values());
    if (type) {
      return all.filter(c => c.type === type);
    }
    return all;
  }

  public listEnabled(type?: ConnectorType): BaseConnector[] {
    return this.list(type).filter(c => c.enabled);
  }

  public ids(): string[] {
    return Array.from(this.connectors.keys());
  }

  public exists(id: string): boolean {
    return this.connectors.has(id);
  }

  public remove(id: string): boolean {
    return this.connectors.delete(id);
  }

  public getLLMs(): BaseConnector[] {
    return this.list('llm');
  }

  public getTools(): BaseConnector[] {
    return this.list('tool');
  }

  public getDataConnectors(): BaseConnector[] {
    return this.list('data');
  }
}
