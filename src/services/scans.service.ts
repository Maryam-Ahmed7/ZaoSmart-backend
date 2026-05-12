import { prisma } from '../prisma';

export class ScanError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

type CreateData = {
  imageUrl: string;
  cropType: string;
  farmId?: string | null;
  predictedDisease?: string | null;
  confidence?: number | null;
  notes?: string | null;
};

type ListFilters = {
  farmId?: string;
  cropType?: string;
};

export async function createScan(userId: string, data: CreateData) {
  if (data.farmId) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) throw new ScanError(404, 'Farm not found');
  }

  return prisma.scan.create({
    data: {
      userId,
      farmId:           data.farmId ?? null,
      imageUrl:         data.imageUrl,
      cropType:         data.cropType,
      predictedDisease: data.predictedDisease ?? null,
      confidence:       data.confidence ?? null,
      notes:            data.notes ?? null,
    },
  });
}

export async function listScans(userId: string, filters: ListFilters) {
  return prisma.scan.findMany({
    where: {
      userId,
      ...(filters.farmId   ? { farmId: filters.farmId }     : {}),
      ...(filters.cropType ? { cropType: filters.cropType } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getScan(userId: string, scanId: string) {
  const scan = await prisma.scan.findFirst({ where: { id: scanId, userId } });
  if (!scan) throw new ScanError(404, 'Scan not found');
  return scan;
}

export async function deleteScan(userId: string, scanId: string) {
  const scan = await prisma.scan.findFirst({ where: { id: scanId, userId } });
  if (!scan) throw new ScanError(404, 'Scan not found');
  await prisma.scan.delete({ where: { id: scanId } });
}
