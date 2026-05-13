import { prisma } from '../prisma';

export class ScanError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

type CreateData = {
  cropType:         string;
  predictedDisease?: string | null;
  diseaseId?:       string | null;
  farmId?:          string | null;
  confidence?:      number | null;
  confidenceTier?:  string | null;
  severity?:        string | null;
  isPremiumResult?: boolean;
  notes?:           string | null;
};

type ListFilters = {
  farmId?:   string;
  cropType?: string;
};

const DISEASE_INCLUDE = { disease: true } as const;

export async function createScan(userId: string, data: CreateData) {
  if (data.farmId) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) throw new ScanError(404, 'Farm not found');
  }

  // Prefer explicit diseaseId; fall back to name lookup for backward compat
  let diseaseId = data.diseaseId ?? null;
  if (!diseaseId && data.predictedDisease) {
    const match = await prisma.disease.findFirst({
      where:  { name: { equals: data.predictedDisease, mode: 'insensitive' } },
      select: { id: true },
    });
    diseaseId = match?.id ?? null;
  }

  return prisma.scan.create({
    data: {
      userId,
      farmId:           data.farmId           ?? null,
      diseaseId,
      cropType:         data.cropType,
      predictedDisease: data.predictedDisease  ?? null,
      confidence:       data.confidence        ?? null,
      confidenceTier:   data.confidenceTier    ?? null,
      severity:         data.severity          ?? null,
      isPremiumResult:  data.isPremiumResult   ?? false,
      notes:            data.notes             ?? null,
    },
    include: DISEASE_INCLUDE,
  });
}

export async function listScans(userId: string, filters: ListFilters) {
  return prisma.scan.findMany({
    where: {
      userId,
      ...(filters.farmId   ? { farmId:   filters.farmId }   : {}),
      ...(filters.cropType ? { cropType: filters.cropType } : {}),
    },
    include: DISEASE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getScan(userId: string, scanId: string) {
  const scan = await prisma.scan.findFirst({
    where:   { id: scanId, userId },
    include: DISEASE_INCLUDE,
  });
  if (!scan) throw new ScanError(404, 'Scan not found');
  return scan;
}

export async function deleteScan(userId: string, scanId: string) {
  const scan = await prisma.scan.findFirst({ where: { id: scanId, userId } });
  if (!scan) throw new ScanError(404, 'Scan not found');
  await prisma.scan.delete({ where: { id: scanId } });
}
