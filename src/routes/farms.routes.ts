import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { create, list, getOne, update, remove } from '../controllers/farms.controller';

const router = Router();

router.use(authenticate);

router.post('/',    create);
router.get('/',     list);
router.get('/:id',  getOne);
router.put('/:id',  update);
router.delete('/:id', remove);

export default router;
