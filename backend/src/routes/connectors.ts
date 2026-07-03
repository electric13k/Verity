import { Router } from 'express';
import { ConnectorRegistry } from '../services/connectors/registry';
import { encrypt, decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

const router = Router();
const registry = ConnectorRegistry.getInstance();

router.get('/', (_req, res) => {
  const connectors = registry.list().map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    description: c.description,
    metadata: c.metadata,
    enabled: c.enabled,
    costPerCall: c.costPerCall
  }));
  res.json(connectors);
});

router.get('/:id', (req, res) => {
  const connector = registry.get(req.params.id);
  if (!connector) return res.status(404).json({ error: 'Connector not found' });
  
  res.json({
    id: connector.id,
    name: connector.name,
    type: connector.type,
    description: connector.description,
    metadata: connector.metadata,
    enabled: connector.enabled,
    costPerCall: connector.costPerCall,
    config: connector.config // Note: in a real app, you'd mask the API keys
  });
});

router.post('/:id/enable', (req, res) => {
  const connector = registry.get(req.params.id);
  if (!connector) return res.status(404).json({ error: 'Connector not found' });
  connector.enabled = true;
  res.json({ success: true, enabled: true });
});

router.post('/:id/disable', (req, res) => {
  const connector = registry.get(req.params.id);
  if (!connector) return res.status(404).json({ error: 'Connector not found' });
  connector.enabled = false;
  res.json({ success: true, enabled: false });
});

router.post('/:id/config', (req, res) => {
  const connector = registry.get(req.params.id);
  if (!connector) return res.status(404).json({ error: 'Connector not found' });
  
  try {
    const config = req.body;
    // In a real app, we would encrypt specific fields before storing
    connector.config = { ...connector.config, ...config };
    res.json({ success: true, config: connector.config });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
