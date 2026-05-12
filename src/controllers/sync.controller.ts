import { Request, Response, NextFunction } from 'express';
import * as syncService from '../services/sync.service';
import { SyncError } from '../services/sync.service';
import { AuthRequest } from '../middleware/auth';

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof SyncError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err);
}

export async function upload(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const { deviceId, farms, scans } = req.body ?? {};

  if (!deviceId || typeof deviceId !== 'string') {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }

  try {
    const result = await syncService.uploadSync(userId, deviceId, { farms, scans });
    res.json(result);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  try {
    const result = await syncService.getSyncStatus(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
