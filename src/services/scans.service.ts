import { prisma } from '../prisma';

export class ScanError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

type CreateData = {
  id?:              string;
  cropType:         string;
  predictedDisease?: string | null;  // display name  e.g. "Gray Leaf Spot"
  diseaseId?:       string | null;   // model key     e.g. "maize_gray_leaf_spot"
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
    scanId:    data.id,
    cropType:  data.cropType,
    disease:   data.predictedDisease,
    modelKey:  data.diseaseId,
    confidence: data.confidence,
    farmId:    data.farmId,
  });

  // ── Farm validation ────────────────────────────────────────────────────────
  if (data.farmId) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) {
      console.warn('[ScansService] FARM_NOT_FOUND — storing scan without farm link', { farmId: data.farmId, userId });
      data = { ...data, farmId: null };
    }
  }

  // ── Disease resolution ─────────────────────────────────────────────────────
  // Two identifiers arrive from the frontend:
  //   predictedDisease = display name  e.g. "Gray Leaf Spot"
  //   diseaseId        = model key     e.g. "maize_gray_leaf_spot"
  //
  // Strategy: try display name first (better for human readability in Prisma),
  // fall back to model key, create row if neither exists — so the Disease table
  // is populated dynamically from real scan uploads without any manual seeding.

  const displayName   = data.predictedDisease?.trim() || null;
  const modelKey      = data.diseaseId?.trim()        || null;
  const anyIdentifier = displayName ?? modelKey;

  console.log('[DISEASE] PAYLOAD_RECEIVED', {
    displayName,
    modelKey,
    anyIdentifier,
    cropType:  data.cropType,
    severity:  data.severity ?? null,
  });

  let resolvedDiseaseId: string | null = null;

  if (!anyIdentifier) {
    console.warn('[DISEASE] SKIPPED — both diseaseName and modelKey are null/empty; diseaseId will be null on scan');
  } else {

    // ── Step 1: look up by display name (insensitive exact match) ─────────
    console.log('[DISEASE] LOOKUP', { strategy: 'displayName', value: displayName });

    let disease = displayName
      ? await prisma.disease.findFirst({
          where: { name: { equals: displayName, mode: 'insensitive' } },
        })
      : null;

    // ── Step 2: fall back to model key if display name returned nothing ───
    if (!disease && modelKey) {
      console.log('[DISEASE] LOOKUP', { strategy: 'modelKey_fallback', value: modelKey });
      disease = await prisma.disease.findFirst({
        where: { name: { equals: modelKey, mode: 'insensitive' } },
      });
    }

    // ── Step 3: not found → auto-create ───────────────────────────────────
    if (!disease) {
      const nameToStore = displayName ?? modelKey!;
      console.log('[DISEASE] NOT_FOUND', {
        triedDisplayName: displayName,
        triedModelKey:    modelKey,
        willCreate:       nameToStore,
      });
      console.log('[DISEASE] CREATED — inserting Disease row', {
        name:     nameToStore,
        cropType: data.cropType,
        severity: data.severity ?? 'moderate',
      });

      // upsert prevents unique-constraint crash if two syncs race on the same name
      disease = await prisma.disease.upsert({
        where:  { name: nameToStore },
        update: {},
        create: {
          name:        nameToStore,
          cropType:    data.cropType,
          description: `Auto-created by ZaoSmart AI scan: ${nameToStore}`,
          severity:    data.severity ?? 'moderate',
          symptoms:    'Detected by on-device TFLite model. Manual agronomist review recommended.',
          treatment:   'Consult a local agronomist for treatment guidance.',
          isActive:    true,
        },
      });

      console.log('[DISEASE] CREATED', { id: disease.id, name: disease.name, cropType: disease.cropType });
    } else {
      console.log('[DISEASE] FOUND', { id: disease.id, name: disease.name });
    }

    resolvedDiseaseId = disease.id;
    console.log('[DISEASE] CONNECTED_TO_SCAN', {
      diseaseId:   resolvedDiseaseId,
      diseaseName: disease.name,
      scanId:      data.id ?? '(server-assigned)',
    });
  }

  // ── Prisma insert ──────────────────────────────────────────────────────────
  const insertPayload = {
    id:               data.id,
    userId,
    farmId:           data.farmId           ?? null,
    diseaseId:        resolvedDiseaseId,             // ← DB UUID now, not model key
    cropType:         data.cropType,
    predictedDisease: data.predictedDisease  ?? null,
    confidence:       data.confidence        ?? null,
    confidenceTier:   data.confidenceTier    ?? null,
    severity:         data.severity          ?? null,
    isPremiumResult:  data.isPremiumResult   ?? false,
    notes:            data.notes             ?? null,
  };
  console.log('[ScansService] INSERT_SCAN', JSON.stringify(insertPayload));

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

  console.log('[ScansService] SCAN_CREATED', {
    id:        scan.id,
    userId,
    diseaseId: scan.diseaseId,
    cropType:  scan.cropType,
  });
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
