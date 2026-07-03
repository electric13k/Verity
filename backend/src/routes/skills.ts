import { Router } from 'express';
import { SkillService } from '../services/skills/service';
import { logger } from '../utils/logger';

const router = Router();
const skillService = SkillService.getInstance();

router.get('/', (req, res) => {
  try {
    const skills = skillService.getSkills();
    res.json(skills);
  } catch (err: any) {
    logger.error(`Error fetching skills: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

router.post('/:id/execute', async (req, res) => {
  try {
    const { input } = req.body;
    const result = await skillService.executeSkill(req.params.id, input);
    res.json({ result });
  } catch (err: any) {
    logger.error(`Error executing skill ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
