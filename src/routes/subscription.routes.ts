import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getMe, trial, activate, cancel } from '../controllers/subscription.controller';

const router = Router();

router.use(authenticate);

router.get('/',         getMe);     // GET /subscription   ← used by initialSync
router.get('/me',       getMe);     // GET /subscription/me
router.post('/trial',   trial);     // POST /subscription/trial   ← start free trial
router.post('/activate', activate); // POST /subscription/activate ← paid premium
router.post('/cancel',   cancel);

export default router;
