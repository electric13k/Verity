import { Router } from 'express';
import { ConnectorRegistry } from '../services/connectors/registry';

const router = Router();
const registry = ConnectorRegistry.getInstance();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectors: {
      total: registry.ids().length,
      enabled: registry.listEnabled().length,
      llms: registry.getLLMs().length,
      tools: registry.getTools().length,
      data: registry.getDataConnectors().length
    }
  });
});

export default router;
