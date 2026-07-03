import { logger } from '../../utils/logger';
import { spawn, ChildProcess } from 'child_process';
import { ConnectorMetadata } from '../../types/index';

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class MCPClient {
  private static instance: MCPClient;
  private servers: Map<string, ChildProcess> = new Map();

  private constructor() {}

  public static getInstance(): MCPClient {
    if (!MCPClient.instance) {
      MCPClient.instance = new MCPClient();
    }
    return MCPClient.instance;
  }

  public async startServer(config: MCPServerConfig): Promise<void> {
    try {
      const child = spawn(config.command, config.args, {
        env: { ...process.env, ...config.env }
      });

      child.on('error', (err) => {
        logger.error(`MCP Server ${config.id} error: ${err.message}`);
      });

      child.on('exit', (code) => {
        logger.info(`MCP Server ${config.id} exited with code ${code}`);
        this.servers.delete(config.id);
      });

      this.servers.set(config.id, child);
      logger.info(`MCP Server ${config.name} started successfully`);
    } catch (err: any) {
      logger.error(`Failed to start MCP Server ${config.name}: ${err.message}`);
      throw err;
    }
  }

  public async stopServer(id: string): Promise<void> {
    const child = this.servers.get(id);
    if (child) {
      child.kill();
      this.servers.delete(id);
    }
  }

  public getActiveServers(): string[] {
    return Array.from(this.servers.keys());
  }
}
