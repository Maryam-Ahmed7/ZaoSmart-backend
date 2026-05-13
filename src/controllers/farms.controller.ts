import { Request, Response, NextFunction } from 'express';
import * as farmsService from '../services/farms.service';
import { FarmError } from '../services/farms.service';
import { AuthRequest } from '../middleware/auth';

const VALID_CROP_TYPES = ['maize', 'potato', 'coffee'];

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof FarmError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err);
}

// Shape returned to frontend — matches FarmDto in farms.api.ts
function toDto(farm: {
  id: string; name: string; cropType: string;
  location: string | null; sizeHa: number | null; notes: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:        farm.id,
    name:      farm.name,
    cropType:  farm.cropType,
    location:  farm.location  ?? undefined,
    sizeHa:    farm.sizeHa    ?? undefined,
    notes:     farm.notes     ?? undefined,
    createdAt: farm.createdAt.toISOString(),
    updatedAt: farm.updatedAt.toISOString(),
  };
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const { name, cropType, location, sizeHa, notes } = req.body ?? {};

  if (!name || !cropType) {
    res.status(400).json({ error: 'name and cropType are required' });
    return;
  }
  if (!VALID_CROP_TYPES.includes(cropType)) {
    res.status(400).json({ error: `cropType must be one of: ${VALID_CROP_TYPES.join(', ')}` });
    return;
  }

  try {
    const farm = await farmsService.createFarm(userId, { name, cropType, location, sizeHa, notes });
    res.status(201).json(toDto(farm));
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  try {
    const farms = await farmsService.listFarms(userId);
    res.json(farms.map(toDto));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const farmId = req.params.id as string;
  try {
    const farm = await farmsService.getFarm(userId, farmId);
    res.json(toDto(farm));
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const farmId = req.params.id as string;
  const { name, cropType, location, sizeHa, notes } = req.body ?? {};

  if (cropType !== undefined && !VALID_CROP_TYPES.includes(cropType)) {
    res.status(400).json({ error: `cropType must be one of: ${VALID_CROP_TYPES.join(', ')}` });
    return;
  }

  try {
    const farm = await farmsService.updateFarm(userId, farmId, { name, cropType, location, sizeHa, notes });
    res.json(toDto(farm));
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const farmId = req.params.id as string;
  try {
    await farmsService.deleteFarm(userId, farmId);
    res.status(204).send();
  } catch (err) {
    handleError(err, res, next);
  }
}
