import fs from 'fs/promises';
import path from 'path';
import { BaseConnector } from '../base';
import { ExecutionContext, ExecutionResult, ConnectorMetadata } from '../../../types/index';

export class FileReadConnector extends BaseConnector {
  id = 'file-read';
  name = 'File Reader';
  type: 'tool' = 'tool';
  description = 'Safely reads files from allowed directories';
  metadata: ConnectorMetadata = {
    capabilities: ['file-system', 'data-access', 'local-files']
  };
  costPerCall = 0;

  private allowedDirectories: string[] = [
    path.resolve(process.cwd(), 'data'),
    path.resolve(process.cwd(), 'plugins'),
    path.resolve(process.cwd(), 'logs')
  ];

  async validate(input: any): Promise<boolean> {
    return this.validateRequired(input, ['filePath']);
  }

  async estimateCost(_input: any): Promise<number> {
    return 0;
  }

  async execute(input: any, _context: ExecutionContext): Promise<ExecutionResult> {
    try {
      const targetPath = path.resolve(input.filePath);
      const isAllowed = this.allowedDirectories.some(dir => targetPath.startsWith(dir));

      if (!isAllowed) {
        return this.error('Access denied: File is outside of allowed directories');
      }

      const content = await fs.readFile(targetPath, 'utf8');
      return this.success(content);
    } catch (error: any) {
      return this.error(error.message);
    }
  }
}
