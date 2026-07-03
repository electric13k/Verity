import os from 'os';
import { BaseConnector } from '../base';
import { ExecutionContext, ExecutionResult, ConnectorMetadata } from '../../../types/index';

export class SystemInfoConnector extends BaseConnector {
  id = 'system-info';
  name = 'System Info';
  type: 'tool' = 'tool';
  description = 'Retrieves local system information';
  metadata: ConnectorMetadata = {
    capabilities: ['hardware-info', 'os-stats', 'local-monitoring']
  };
  costPerCall = 0;

  async validate(_input: any): Promise<boolean> {
    return true;
  }

  async estimateCost(_input: any): Promise<number> {
    return 0;
  }

  async execute(_input: any, _context: ExecutionContext): Promise<ExecutionResult> {
    try {
      const info = {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        hostname: os.hostname(),
        loadAvg: os.loadavg()
      };
      return this.success(info);
    } catch (error: any) {
      return this.error(error.message);
    }
  }
}
