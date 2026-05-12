import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { list, getOne, create, update, remove } from '../controllers/diseases.controller';

const router = Router();

router.get('/',     list);
router.get('/:id',  getOne);

router.post('/',    authenticate, create);
router.put('/:id',  authenticate, update);
router.delete('/:id', authenticate, remove);

export default router;
