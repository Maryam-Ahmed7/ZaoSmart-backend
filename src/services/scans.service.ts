import { prisma } from '../prisma';

export class ScanError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

type CreateData = {
  id?:              string;   // client-provided UUID — preserved for cross-device consistency
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
  console.log('[ScansService] CREATE_SCAN', {
    userId,
    id:       data.id,
    cropType: data.cropType,
    disease:  data.predictedDisease,
    confidence: data.confidence,
    farmId:   data.farmId,
  });

  if (data.farmId) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) {
      console.warn('[ScansService] FARM_NOT_FOUND — storing scan without farm link', {
        farmId: data.farmId,
        userId,
      });
      // Do not throw — store the scan without the farm link rather than losing the record.
      data = { ...data, farmId: null };
    }
  }

  // ── Disease resolution ────────────────────────────────────────────────────
  // Audit: log exactly what the incoming scan carries so we can spot mismatches
  // between what the frontend sends and what the DB lookup expects.
  console.log('[DiseaseResolver] INCOMING_PAYLOAD', {
    predictedDisease:  data.predictedDisease,   // ← must be non-null/non-empty to proceed
    clientDiseaseId:   data.diseaseId,           // model-local ID (ignored for DB FK)
    cropType:          data.cropType,
    severity:          data.severity,
    willResolve:       !!data.predictedDisease,  // false = resolver skipped entirely
  });

  let diseaseId: string | null = null;

  if (!data.predictedDisease) {
    // diseaseName was empty or missing — nothing to look up or create.
    console.warn('[DiseaseResolver] SKIPPED — predictedDisease is null/empty; scan will have diseaseId=null');
  } else {
    console.log('[DiseaseResolver] LOOKUP_START', {
      searchName: data.predictedDisease,
      cropType:   data.cropType,
    });

    let disease = await prisma.disease.findFirst({
      where: { name: { equals: data.predictedDisease, mode: 'insensitive' } },
    });

    console.log('[DiseaseResolver] LOOKUP_RESULT', {
      found:        !!disease,
      existingId:   disease?.id   ?? null,
      existingName: disease?.name ?? null,
    });

    if (!disease) {
      console.log('[DiseaseResolver] NOT_FOUND — will auto-create');
      console.log('[DiseaseResolver] AUTO_CREATE', {
        name:     data.predictedDisease,
        cropType: data.cropType,
        severity: data.severity ?? 'moderate',
      });

      // upsert guards against duplicate-key race on concurrent syncs
      disease = await prisma.disease.upsert({
        where:  { name: data.predictedDisease },
        update: {},
        create: {
          name:        data.predictedDisease,
          cropType:    data.cropType,
          description: `Auto-created via ZaoSmart AI scan: ${data.predictedDisease}`,
          severity:    data.severity ?? 'moderate',
          symptoms:    'Detected by on-device TFLite model. Manual verification recommended.',
          treatment:   'Consult a local agronomist for specific treatment guidance.',
          isActive:    true,
        },
      });

      console.log('[DiseaseResolver] CREATED', {
        id:   disease.id,
        name: disease.name,
      });
    }

    diseaseId = disease.id;
    console.log('[DiseaseResolver] LINKED_TO_SCAN', { diseaseId, diseaseName: disease.name });
  }

  const insertPayload = {
    id:               data.id,
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
  };
  console.log('[ScansService] INSERT_SCAN — Prisma payload:', JSON.stringify(insertPayload));

  let scan;
  try {
    if (data.id) {
      scan = await prisma.scan.upsert({
        where:   { id: data.id },
        update:  {},
        create:  insertPayload,
        include: DISEASE_INCLUDE,
      });
    } else {
      const { id: _id, ...createPayload } = insertPayload;
      scan = await prisma.scan.create({
        data:    createPayload,
        include: DISEASE_INCLUDE,
      });
    }
  } catch (prismaErr: unknown) {
    const e = prismaErr as Error & { code?: string; meta?: unknown };
    console.error('[ScansService] PRISMA_ERROR', {
      message: e.message,
      code:    e.code,
      meta:    e.meta,
      stack:   e.stack,
    });
    throw prismaErr;
  }

  console.log('[ScansService] SCAN_CREATED', { id: scan.id, userId });
  return scan;
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
