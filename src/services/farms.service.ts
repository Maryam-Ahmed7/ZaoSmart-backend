import { prisma } from '../prisma';

export class FarmError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'FarmError';
  }
}

type CreateData = {
  name: string;
  cropType: string;
  region?: string | null;
  size?: number | null;
  plantingDate?: string | null;
};

type UpdateData = Partial<CreateData>;

export async function createFarm(userId: string, data: CreateData) {
  return prisma.farm.create({
    data: {
      userId,
      name: data.name,
      cropType: data.cropType,
      region: data.region ?? null,
      size: data.size ?? null,
      plantingDate: data.plantingDate ? new Date(data.plantingDate) : null,
    },
  });
}

export async function listFarms(userId: string) {
  return prisma.farm.findMany({
    where: { userId },
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
      ...(data.name !== undefined        && { name: data.name }),
      ...(data.cropType !== undefined    && { cropType: data.cropType }),
      ...(data.region !== undefined      && { region: data.region }),
      ...(data.size !== undefined        && { size: data.size }),
      ...(data.plantingDate !== undefined && {
        plantingDate: data.plantingDate ? new Date(data.plantingDate) : null,
      }),
    },
  });
}

export async function deleteFarm(userId: string, farmId: string) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new FarmError(404, 'Farm not found');
  await prisma.farm.delete({ where: { id: farmId } });
}
