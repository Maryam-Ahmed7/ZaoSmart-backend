import { prisma } from '../prisma';

export class SyncError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

const VALID_CROP_TYPES = ['maize', 'potato', 'coffee'];

type SyncFarmInput = {
  id?: string;
  name?: string;
  cropType?: string;
  region?: string | null;
  size?: number | null;
  plantingDate?: string | null;
  createdAt?: string;
};

type SyncScanInput = {
  id?: string;
  imageUrl?: string;
  cropType?: string;
  farmId?: string | null;
  predictedDisease?: string | null;
  confidence?: number | null;
  notes?: string | null;
  createdAt?: string;
};

type SyncPayload = {
  farms?: unknown[];
  scans?: unknown[];
};

type SyncResult = {
  syncedCounts:    { farms: number; scans: number };
  skipped:         { farms: number; scans: number };
  conflicts:       string[];
  serverTimestamp: string;
};

// ─── Upload ────────────────────────────────────────────────────────────────────

export async function uploadSync(
  userId: string,
  deviceId: string,
  payload: SyncPayload,
): Promise<SyncResult> {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) throw new SyncError(403, 'Device does not belong to this user');

  const result: SyncResult = {
    syncedCounts:    { farms: 0, scans: 0 },
    skipped:         { farms: 0, scans: 0 },
    conflicts:       [],
    serverTimestamp: new Date().toISOString(),
  };

  // ── Farms ────────────────────────────────────────────────────────────────────
  const farms = Array.isArray(payload.farms) ? (payload.farms as SyncFarmInput[]) : [];
  // Tracks client farm ID → the server ID that was created or already existed
  const farmIdMap = new Map<string, string>();

  for (const farm of farms) {
    if (!farm.id || !farm.name || !farm.cropType) {
      result.conflicts.push('Farm skipped: id, name, and cropType are required');
      continue;
    }
    if (!VALID_CROP_TYPES.includes(farm.cropType)) {
      result.conflicts.push(`Farm ${farm.id} skipped: invalid cropType "${farm.cropType}"`);
      continue;
    }

    try {
      const existing = await prisma.farm.findUnique({ where: { id: farm.id } });
      if (existing) {
        farmIdMap.set(farm.id, existing.id);
        result.skipped.farms++;
        continue;
      }

      await prisma.farm.create({
        data: {
          id:           farm.id,
          userId,
          name:         farm.name,
          cropType:     farm.cropType,
          region:       farm.region ?? null,
          size:         farm.size ?? null,
          plantingDate: farm.plantingDate ? new Date(farm.plantingDate) : null,
          ...(farm.createdAt ? { createdAt: new Date(farm.createdAt) } : {}),
        },
      });
      farmIdMap.set(farm.id, farm.id);
      result.syncedCounts.farms++;
    } catch {
      result.conflicts.push(`Farm ${farm.id}: failed to sync`);
    }
  }

  // ── Scans ────────────────────────────────────────────────────────────────────
  const scans = Array.isArray(payload.scans) ? (payload.scans as SyncScanInput[]) : [];

  for (const scan of scans) {
    if (!scan.id || !scan.imageUrl || !scan.cropType) {
      result.conflicts.push('Scan skipped: id, imageUrl, and cropType are required');
      continue;
    }
    if (!VALID_CROP_TYPES.includes(scan.cropType)) {
      result.conflicts.push(`Scan ${scan.id} skipped: invalid cropType "${scan.cropType}"`);
      continue;
    }

    try {
      const existing = await prisma.scan.findUnique({ where: { id: scan.id } });
      if (existing) {
        result.skipped.scans++;
        continue;
      }

      // Resolve farmId: prefer mapped ID (just created) then fall back to raw ID
      let resolvedFarmId: string | null = null;
      if (scan.farmId) {
        const serverFarmId = farmIdMap.get(scan.farmId) ?? scan.farmId;
        const farm = await prisma.farm.findFirst({ where: { id: serverFarmId, userId } });
        if (farm) {
          resolvedFarmId = farm.id;
        } else {
          result.conflicts.push(
            `Scan ${scan.id}: farmId ${scan.farmId} not found — stored without farm link`,
          );
        }
      }

      // Resolve disease via case-insensitive name match (mirrors scan creation logic)
      let diseaseId: string | null = null;
      if (scan.predictedDisease) {
        const match = await prisma.disease.findFirst({
          where: { name: { equals: scan.predictedDisease, mode: 'insensitive' } },
          select: { id: true },
        });
        diseaseId = match?.id ?? null;
      }

      await prisma.scan.create({
        data: {
          id:               scan.id,
          userId,
          farmId:           resolvedFarmId,
          diseaseId,
          imageUrl:         scan.imageUrl,
          cropType:         scan.cropType,
          predictedDisease: scan.predictedDisease ?? null,
          confidence:       scan.confidence ?? null,
          notes:            scan.notes ?? null,
          ...(scan.createdAt ? { createdAt: new Date(scan.createdAt) } : {}),
        },
      });
      result.syncedCounts.scans++;
    } catch {
      result.conflicts.push(`Scan ${scan.id}: failed to sync`);
    }
  }

  // ── Update lastSyncAt ────────────────────────────────────────────────────────
  await prisma.device.update({
    where: { id: deviceId },
    data:  { lastSyncAt: new Date() },
  });

  return result;
}

// ─── Status ────────────────────────────────────────────────────────────────────

export async function getSyncStatus(userId: string) {
  const devices = await prisma.device.findMany({
    where:   { userId },
    select:  { id: true, name: true, lastSyncAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return {
    devices: devices.map(d => ({
      deviceId:     d.id,
      name:         d.name,
      lastSyncAt:   d.lastSyncAt ?? null,
      registeredAt: d.createdAt,
    })),
    serverTimestamp: new Date().toISOString(),
  };
}
