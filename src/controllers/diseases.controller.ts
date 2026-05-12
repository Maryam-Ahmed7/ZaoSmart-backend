import { Request, Response, NextFunction } from 'express';
import * as diseasesService from '../services/diseases.service';
import { DiseaseError } from '../services/diseases.service';

const VALID_CROP_TYPES = ['maize', 'potato', 'coffee'];
const VALID_SEVERITIES = ['low', 'medium', 'high'];

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof DiseaseError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  if ((err as any)?.code === 'P2002') {
    res.status(409).json({ error: 'A disease with that name already exists' });
    return;
  }
  next(err);
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cropType = typeof req.query.cropType === 'string' ? req.query.cropType : undefined;

  if (cropType && !VALID_CROP_TYPES.includes(cropType)) {
    res.status(400).json({ error: `cropType must be one of: ${VALID_CROP_TYPES.join(', ')}` });
    return;
  }

  try {
    const diseases = await diseasesService.listDiseases({ cropType });
    res.json(diseases);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const disease = await diseasesService.getDisease(req.params.id as string);
    res.json(disease);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { name, description, cropType, severity, symptoms, treatment, isActive } = req.body ?? {};

  if (!name || !description || !cropType || !severity || !symptoms || !treatment) {
    res.status(400).json({ error: 'name, description, cropType, severity, symptoms, and treatment are required' });
    return;
  }
  if (!VALID_CROP_TYPES.includes(cropType)) {
    res.status(400).json({ error: `cropType must be one of: ${VALID_CROP_TYPES.join(', ')}` });
    return;
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
    return;
  }

  try {
    const disease = await diseasesService.createDisease({
      name, description, cropType, severity, symptoms, treatment, isActive,
    });
    res.status(201).json(disease);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { name, description, cropType, severity, symptoms, treatment, isActive } = req.body ?? {};

  if (cropType !== undefined && !VALID_CROP_TYPES.includes(cropType)) {
    res.status(400).json({ error: `cropType must be one of: ${VALID_CROP_TYPES.join(', ')}` });
    return;
  }
  if (severity !== undefined && !VALID_SEVERITIES.includes(severity)) {
    res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });
    return;
  }

  try {
    const disease = await diseasesService.updateDisease(req.params.id as string, {
      name, description, cropType, severity, symptoms, treatment, isActive,
    });
    res.json(disease);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await diseasesService.deleteDisease(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    handleError(err, res, next);
  }
}
