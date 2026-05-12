import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { upload, status } from '../controllers/sync.controller';

const router = Router();

router.use(authenticate);

router.post('/upload', upload);
router.get('/status',  status);

export default router;
