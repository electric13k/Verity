import { Router } from 'express';
import { Orchestrator } from '../services/orchestrator/index';
import { logger } from '../utils/logger';
import { z } from 'zod';

const router = Router();
const orchestrator = new Orchestrator();

// In-memory task store for development
const tasks: Map<string, any> = new Map();

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  constraints: z.any().optional()
});

router.post('/', async (req: any, res) => {
  try {
    const { title, description, constraints } = taskSchema.parse(req.body);
    const userId = req.user?.id || 'anonymous';
    
    const taskId = crypto.randomUUID();
    const task = {
      id: taskId,
      userId,
      title,
      description,
      status: 'running',
      constraints,
      createdAt: new Date()
    };
    
    tasks.set(taskId, task);

    // Execute task via orchestrator
    const result = await orchestrator.executeTask(description, userId);
    
    const updatedTask = {
      ...task,
      status: result.status,
      completedAt: new Date()
    };
    tasks.set(taskId, updatedTask);

    res.status(201).json({ task: updatedTask, execution: result });
  } catch (error: any) {
    logger.error('Task creation/execution failed', error);
    res.status(400).json({ error: error.message });
  }
});

router.get('/', (req: any, res) => {
  const userId = req.user?.id || 'anonymous';
  const userTasks = Array.from(tasks.values())
    .filter(t => t.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  res.json(userTasks);
});

router.get('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.delete('/:id', (req, res) => {
  if (tasks.delete(req.params.id)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

export default router;
