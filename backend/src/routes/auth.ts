import { Router } from 'express';
import { hashPassword, verifyPassword } from '../utils/encryption';
import { AuthService } from '../services/auth';
import { z } from 'zod';
import { logger } from '../utils/logger';

const router = Router();

// In-memory user store for development (as requested)
const users: Map<string, any> = new Map();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

router.post('/register', async (req, res) => {
  try {
    const { email, password } = authSchema.parse(req.body);
    
    if (Array.from(users.values()).some(u => u.email === email)) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const user = { id, email, passwordHash };
    users.set(id, user);

    const token = AuthService.generateToken({ id, email });
    res.status(201).json({ user: { id, email }, token });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = authSchema.parse(req.body);
    const user = Array.from(users.values()).find(u => u.email === email);

    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = AuthService.generateToken({ id: user.id, email: user.email });
    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/me', (req: any, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.user });
});

router.post('/logout', (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

export default router;
