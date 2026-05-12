import { Request, Response, NextFunction } from 'express';
import * as scansService from '../services/scans.service';
import { ScanError } from '../services/scans.service';
import { AuthRequest } from '../middleware/auth';

const VALID_CROP_TYPES = ['maize', 'potato', 'coffee'];

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ScanError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err);
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const { imageUrl, cropType, farmId, predictedDisease, confidence, notes } = req.body ?? {};

  if (!imageUrl || !cropType) {
    res.status(400).json({ error: 'imageUrl and cropType are required' });
    return;
  }
  if (!VALID_CROP_TYPES.includes(cropType)) {
    res.status(400).json({ error: `cropType must be one of: ${VALID_CROP_TYPES.join(', ')}` });
    return;
  }
  if (confidence !== undefined && confidence !== null) {
    const c = Number(confidence);
    if (isNaN(c) || c < 0 || c > 1) {
      res.status(400).json({ error: 'confidence must be a number between 0 and 1' });
      return;
    }
  }

  try {
    const scan = await scansService.createScan(userId, {
      imageUrl, cropType, farmId, predictedDisease, confidence, notes,
    });
    res.status(201).json(scan);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId   = (req as AuthRequest).userId;
  const farmId   = typeof req.query.farmId   === 'string' ? req.query.farmId   : undefined;
  const cropType = typeof req.query.cropType === 'string' ? req.query.cropType : undefined;

  try {
    const scans = await scansService.listScans(userId, { farmId, cropType });
    res.json(scans);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const scanId = req.params.id as string;

  try {
    const scan = await scansService.getScan(userId, scanId);
    res.json(scan);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const scanId = req.params.id as string;

  try {
    await scansService.deleteScan(userId, scanId);
    res.status(204).send();
  } catch (err) {
    handleError(err, res, next);
  }
}
