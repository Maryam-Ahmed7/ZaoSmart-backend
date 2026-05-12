import { Router } from 'express';
import { register, login, refreshToken, logout, me } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);
router.get('/me', authenticate, me);

export default router;
