import { prisma } from '../prisma';

export class FarmError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'FarmError';
  }
}

type CreateData = {
  name:     string;
  cropType: string;
  location?: string | null;
  sizeHa?:  number | null;
  notes?:   string | null;
};

type UpdateData = Partial<CreateData>;

export async function createFarm(userId: string, data: CreateData) {
  console.log('[FarmsService] CREATE_FARM', { userId, name: data.name, cropType: data.cropType });
  const farm = await prisma.farm.create({
    data: {
      userId,
      name:     data.name,
      cropType: data.cropType,
      location: data.location ?? null,
      sizeHa:   data.sizeHa   ?? null,
      notes:    data.notes    ?? null,
    },
  });
  console.log('[FarmsService] FARM_CREATED', { id: farm.id, userId });
  return farm;
}

export async function listFarms(userId: string) {
  return prisma.farm.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getFarm(userId: string, farmId: string) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new FarmError(404, 'Farm not found');
  return farm;
}

export async function updateFarm(userId: string, farmId: string, data: UpdateData) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new FarmError(404, 'Farm not found');

  return prisma.farm.update({
    where: { id: farmId },
    data: {
      ...(data.name     !== undefined && { name:     data.name }),
      ...(data.cropType !== undefined && { cropType: data.cropType }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.sizeHa   !== undefined && { sizeHa:   data.sizeHa }),
      ...(data.notes    !== undefined && { notes:    data.notes }),
    },
  });
}

export async function deleteFarm(userId: string, farmId: string) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new FarmError(404, 'Farm not found');
  await prisma.farm.delete({ where: { id: farmId } });
}
