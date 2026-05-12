import { prisma } from '../prisma';

export class DiseaseError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'DiseaseError';
  }
}

type CreateData = {
  name: string;
  description: string;
  cropType: string;
  severity: string;
  symptoms: string;
  treatment: string;
  isActive?: boolean;
};

type UpdateData = Partial<CreateData>;

export async function listDiseases(filters: { cropType?: string }) {
  return prisma.disease.findMany({
    where: {
      ...(filters.cropType ? { cropType: filters.cropType } : {}),
    },
    orderBy: { name: 'asc' },
  });
}

export async function getDisease(id: string) {
  const disease = await prisma.disease.findUnique({ where: { id } });
  if (!disease) throw new DiseaseError(404, 'Disease not found');
  return disease;
}

export async function createDisease(data: CreateData) {
  return prisma.disease.create({
    data: {
      name:        data.name,
      description: data.description,
      cropType:    data.cropType,
      severity:    data.severity,
      symptoms:    data.symptoms,
      treatment:   data.treatment,
      isActive:    data.isActive ?? true,
    },
  });
}

export async function updateDisease(id: string, data: UpdateData) {
  const existing = await prisma.disease.findUnique({ where: { id } });
  if (!existing) throw new DiseaseError(404, 'Disease not found');

  return prisma.disease.update({
    where: { id },
    data: {
      ...(data.name        !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.cropType    !== undefined && { cropType: data.cropType }),
      ...(data.severity    !== undefined && { severity: data.severity }),
      ...(data.symptoms    !== undefined && { symptoms: data.symptoms }),
      ...(data.treatment   !== undefined && { treatment: data.treatment }),
      ...(data.isActive    !== undefined && { isActive: data.isActive }),
    },
  });
}

export async function deleteDisease(id: string) {
  const existing = await prisma.disease.findUnique({ where: { id } });
  if (!existing) throw new DiseaseError(404, 'Disease not found');
  await prisma.disease.delete({ where: { id } });
}
