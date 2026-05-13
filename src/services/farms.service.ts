import { prisma } from '../prisma';

export class FarmError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'FarmError';
  }
}

type CreateData = {
  id?:      string;   // client-provided UUID — preserved so scan farmId refs stay valid
  name:     string;
  cropType: string;
  location?: string | null;
  sizeHa?:  number | null;
  notes?:   string | null;
};

type UpdateData = Partial<Omit<CreateData, 'id'>>;

export async function createFarm(userId: string, data: CreateData) {
  console.log('[FarmsService] CREATE_FARM', { userId, id: data.id, name: data.name, cropType: data.cropType });

  let farm;
  if (data.id) {
    // Upsert with client ID so farm references from scans/reminders remain valid.
    // If the ID already exists (e.g., from a previous batch sync) the update is a no-op.
    farm = await prisma.farm.upsert({
      where: { id: data.id },
      update: {},
      create: {
        id:       data.id,
        userId,
        name:     data.name,
        cropType: data.cropType,
        location: data.location ?? null,
        sizeHa:   data.sizeHa   ?? null,
        notes:    data.notes    ?? null,
      },
    });
  } else {
    farm = await prisma.farm.create({
      data: {
        userId,
        name:     data.name,
        cropType: data.cropType,
        location: data.location ?? null,
        sizeHa:   data.sizeHa   ?? null,
        notes:    data.notes    ?? null,
      },
    });
  }

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
