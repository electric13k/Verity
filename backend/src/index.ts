import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { verifyToken } from './middleware/auth';

// Routes
import authRoutes from './routes/auth';
import connectorRoutes from './routes/connectors';
import taskRoutes from './routes/tasks';
import skillRoutes from './routes/skills';
import mcpRoutes from './routes/mcp';
import healthRoutes from './routes/health';

// Services
import { ConnectorRegistry } from './services/connectors/registry';
import { ClaudeConnector } from './services/connectors/llm/claude';
import { OpenAIConnector } from './services/connectors/llm/openai';
import { OllamaConnector } from './services/connectors/llm/ollama';
import { KimiConnector } from './services/connectors/llm/kimi';
import { HTTPToolConnector } from './services/connectors/tools/http';
import { SystemInfoConnector } from './services/connectors/tools/system-info';
import { FileReadConnector } from './services/connectors/tools/file-read';
import { WebFetchConnector } from './services/connectors/data/web-fetch';
import { MCPClient } from './services/mcp/client';
import { SkillService } from './services/skills/service';

const app = express();
const mcpClient = MCPClient.getInstance();
const skillService = SkillService.getInstance();

// Middleware
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

// Initialize Connectors
const initializeConnectors = () => {
  const registry = ConnectorRegistry.getInstance();
  
  registry.register(new ClaudeConnector({ apiKey: env.CLAUDE_API_KEY }));
  registry.register(new OpenAIConnector({ apiKey: env.OPENAI_API_KEY }));
  registry.register(new OllamaConnector({ baseUrl: env.OLLAMA_BASE_URL }));
  registry.register(new KimiConnector({ apiKey: env.KIMI_API_KEY }));
  registry.register(new HTTPToolConnector());
  registry.register(new SystemInfoConnector());
  registry.register(new FileReadConnector());
  registry.register(new WebFetchConnector());
  
  logger.info(`Initialized ${registry.ids().length} connectors`);
};

initializeConnectors();

// Public Routes
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);

// Protected Routes
app.use('/api/connectors', verifyToken as any, connectorRoutes);
app.use('/api/tasks', verifyToken, taskRoutes);
app.use('/api/skills', verifyToken, skillRoutes);
app.use('/api/mcp', verifyToken, mcpRoutes);

// Error Handler
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});
