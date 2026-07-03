import { Router } from 'express';
import { MCPClient } from '../services/mcp/client';
import { logger } from '../utils/logger';

const router = Router();
const mcpClient = MCPClient.getInstance();

router.get('/servers', (req, res) => {
  try {
    const servers = mcpClient.getActiveServers();
    res.json(servers);
  } catch (err: any) {
    logger.error(`Error fetching MCP servers: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch MCP servers' });
  }
});

router.post('/servers/start', async (req, res) => {
  try {
    const config = req.body;
    await mcpClient.startServer(config);
    res.json({ message: `Server ${config.name} started` });
  } catch (err: any) {
    logger.error(`Error starting MCP server: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/servers/:id/stop', async (req, res) => {
  try {
    await mcpClient.stopServer(req.params.id);
    res.json({ message: `Server ${req.params.id} stopped` });
  } catch (err: any) {
    logger.error(`Error stopping MCP server: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
