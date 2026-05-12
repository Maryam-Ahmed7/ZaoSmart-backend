import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getMe, activate, cancel } from '../controllers/subscription.controller';

const router = Router();

router.use(authenticate);

router.get('/me',       getMe);
router.get('/status',   getMe);   // alias — same data, dev/admin label per spec
router.post('/activate', activate);
router.post('/cancel',   cancel);

export default router;
