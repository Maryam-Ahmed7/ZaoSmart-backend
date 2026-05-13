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

function getConfidenceTier(confidence: number | null): 'high' | 'medium' | 'low' | 'uncertain' {
  if (!confidence) return 'uncertain';
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.65) return 'medium';
  if (confidence >= 0.45) return 'low';
  return 'uncertain';
}

// Shape returned to frontend — matches ScanDto in scans.api.ts
function toDto(scan: {
  id: string; cropType: string; farmId: string | null; diseaseId: string | null;
  predictedDisease: string | null; confidence: number | null;
  confidenceTier: string | null; severity: string | null;
  isPremiumResult: boolean; createdAt: Date;
  disease?: { name: string; severity: string } | null;
}) {
  const tier = (scan.confidenceTier ?? getConfidenceTier(scan.confidence)) as
    'high' | 'medium' | 'low' | 'uncertain';
  return {
    id:              scan.id,
    cropId:          scan.cropType,
    farmId:          scan.farmId          ?? undefined,
    diseaseId:       scan.diseaseId       ?? undefined,
    diseaseName:     scan.predictedDisease ?? scan.disease?.name ?? '',
    confidence:      scan.confidence      ?? 0,
    confidenceTier:  tier,
    severity:        (scan.severity ?? scan.disease?.severity ?? undefined) as
                       'mild' | 'moderate' | 'severe' | undefined,
    isPremiumResult: scan.isPremiumResult,
    scannedAt:       scan.createdAt.toISOString(),
    createdAt:       scan.createdAt.toISOString(),
  };
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  // Accept both frontend field names (cropId, diseaseName) and legacy names
  const {
    cropId, cropType,
    diseaseName, predictedDisease,
    diseaseId,
    farmId, confidence, confidenceTier, severity, isPremiumResult, notes,
  } = req.body ?? {};

  const resolvedCropType = cropId ?? cropType;
  const resolvedDisease  = diseaseName ?? predictedDisease;

  if (!resolvedCropType) {
    res.status(400).json({ error: 'cropId (or cropType) is required' });
    return;
  }
  if (!VALID_CROP_TYPES.includes(resolvedCropType)) {
    res.status(400).json({ error: `cropType must be one of: ${VALID_CROP_TYPES.join(', ')}` });
    return;
  }

  try {
    const scan = await scansService.createScan(userId, {
      cropType:         resolvedCropType,
      predictedDisease: resolvedDisease  ?? null,
      diseaseId:        diseaseId        ?? null,
      farmId:           farmId           ?? null,
      confidence:       confidence       ?? null,
      confidenceTier:   confidenceTier   ?? null,
      severity:         severity         ?? null,
      isPremiumResult:  isPremiumResult  ?? false,
      notes:            notes            ?? null,
    });
    res.status(201).json(toDto(scan));
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
    res.json(scans.map(toDto));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const scanId = req.params.id as string;
  try {
    const scan = await scansService.getScan(userId, scanId);
    res.json(toDto(scan));
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
