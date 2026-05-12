import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { create, list, getOne, remove } from '../controllers/scans.controller';

const router = Router();

router.use(authenticate);

router.post('/',    create);
router.get('/',     list);
router.get('/:id',  getOne);
router.delete('/:id', remove);

export default router;
