import { prisma } from '../prisma';

export class SyncError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

const VALID_CROP_TYPES = ['maize', 'potato', 'coffee'];

type SyncFarmInput = {
  id?:        string;
  name?:      string;
  cropType?:  string;
  location?:  string | null;
  sizeHa?:    number | null;
  notes?:     string | null;
  createdAt?: string;
};

type SyncScanInput = {
  id?:              string;
  cropId?:          string;   // alias for cropType
  cropType?:        string;
  farmId?:          string | null;
  diseaseId?:       string | null;
  diseaseName?:     string | null;  // alias for predictedDisease
  predictedDisease?: string | null;
  confidence?:      number | null;
  confidenceTier?:  string | null;
  severity?:        string | null;
  isPremiumResult?: boolean;
  notes?:           string | null;
  createdAt?:       string;
};

type SyncReminderInput = {
  id?:          string;
  title?:       string;
  cropId?:      string | null;
  farmId?:      string | null;
  scheduledAt?: string;
  isCompleted?: boolean;
  recurrence?:  string | null;
  createdAt?:   string;
};

type SyncPayload = {
  farms?:     unknown[];
  scans?:     unknown[];
  reminders?: unknown[];
};

type SyncCounts = { farms: number; scans: number; reminders: number };

type SyncResult = {
  syncedCounts:    SyncCounts;
  skipped:         SyncCounts;
  conflicts:       string[];
  serverTimestamp: string;
};

// ─── Upload ────────────────────────────────────────────────────────────────────

export async function uploadSync(
  userId:   string,
  deviceId: string,
  payload:  SyncPayload,
): Promise<SyncResult> {
  const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
  if (!device) throw new SyncError(403, 'Device does not belong to this user');

  const result: SyncResult = {
    syncedCounts:    { farms: 0, scans: 0, reminders: 0 },
    skipped:         { farms: 0, scans: 0, reminders: 0 },
    conflicts:       [],
    serverTimestamp: new Date().toISOString(),
  };

  const farmIdMap = new Map<string, string>();

  // ── Farms ──────────────────────────────────────────────────────────────────
  const farms = Array.isArray(payload.farms) ? (payload.farms as SyncFarmInput[]) : [];
  console.log('[Sync] UPLOAD_START', { userId, deviceId, farms: farms.length, scans: (payload.scans as unknown[])?.length ?? 0, reminders: (payload.reminders as unknown[])?.length ?? 0 });

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
        console.log('[Sync] FARM_SKIPPED_EXISTS', { id: farm.id });
        farmIdMap.set(farm.id, existing.id);
        result.skipped.farms++;
        continue;
      }
      console.log('[Sync] UPSERT_FARM', { id: farm.id, name: farm.name, cropType: farm.cropType, userId });

      await prisma.farm.create({
        data: {
          id:       farm.id,
          userId,
          name:     farm.name,
          cropType: farm.cropType,
          location: farm.location ?? null,
          sizeHa:   farm.sizeHa   ?? null,
          notes:    farm.notes    ?? null,
          ...(farm.createdAt ? { createdAt: new Date(farm.createdAt) } : {}),
        },
      });
      farmIdMap.set(farm.id, farm.id);
      result.syncedCounts.farms++;
      console.log('[Sync] FARM_INSERTED', { id: farm.id, userId });
    } catch (e) {
      console.error('[Sync] FARM_ERROR', { id: farm.id, error: (e as Error).message });
      result.conflicts.push(`Farm ${farm.id}: failed to sync`);
    }
  }

  // ── Scans ──────────────────────────────────────────────────────────────────
  const scans = Array.isArray(payload.scans) ? (payload.scans as SyncScanInput[]) : [];
  for (const scan of scans) {
    const cropType = scan.cropId ?? scan.cropType;
    if (!scan.id || !cropType) {
      result.conflicts.push('Scan skipped: id and cropId are required');
      continue;
    }
    if (!VALID_CROP_TYPES.includes(cropType)) {
      result.conflicts.push(`Scan ${scan.id} skipped: invalid cropType "${cropType}"`);
      continue;
    }
    try {
      const existing = await prisma.scan.findUnique({ where: { id: scan.id } });
      if (existing) { result.skipped.scans++; continue; }

      let resolvedFarmId: string | null = null;
      if (scan.farmId) {
        const serverFarmId = farmIdMap.get(scan.farmId) ?? scan.farmId;
        const farm = await prisma.farm.findFirst({ where: { id: serverFarmId, userId } });
        resolvedFarmId = farm?.id ?? null;
        if (!farm) result.conflicts.push(`Scan ${scan.id}: farmId not found — stored without link`);
      }

      const diseaseName = scan.diseaseName ?? scan.predictedDisease ?? null;
      let diseaseId = scan.diseaseId ?? null;
      if (!diseaseId && diseaseName) {
        const match = await prisma.disease.findFirst({
          where:  { name: { equals: diseaseName, mode: 'insensitive' } },
          select: { id: true },
        });
        diseaseId = match?.id ?? null;
      }

      console.log('[Sync] UPSERT_SCAN', { id: scan.id, cropType, disease: diseaseName, userId });
      await prisma.scan.create({
        data: {
          id:               scan.id,
          userId,
          farmId:           resolvedFarmId,
          diseaseId,
          cropType,
          predictedDisease: diseaseName,
          confidence:       scan.confidence      ?? null,
          confidenceTier:   scan.confidenceTier  ?? null,
          severity:         scan.severity        ?? null,
          isPremiumResult:  scan.isPremiumResult ?? false,
          notes:            scan.notes           ?? null,
          ...(scan.createdAt ? { createdAt: new Date(scan.createdAt) } : {}),
        },
      });
      result.syncedCounts.scans++;
      console.log('[Sync] SCAN_INSERTED', { id: scan.id, userId });
    } catch (e) {
      console.error('[Sync] SCAN_ERROR', { id: scan.id, error: (e as Error).message });
      result.conflicts.push(`Scan ${scan.id}: failed to sync`);
    }
  }

  // ── Reminders ─────────────────────────────────────────────────────────────
  const reminders = Array.isArray(payload.reminders) ? (payload.reminders as SyncReminderInput[]) : [];
  for (const reminder of reminders) {
    if (!reminder.id || !reminder.title || !reminder.scheduledAt) {
      result.conflicts.push('Reminder skipped: id, title, and scheduledAt are required');
      continue;
    }
    try {
      const existing = await prisma.reminder.findUnique({ where: { id: reminder.id } });
      if (existing) { result.skipped.reminders++; continue; }

      let resolvedFarmId: string | null = null;
      if (reminder.farmId) {
        const farm = await prisma.farm.findFirst({ where: { id: reminder.farmId, userId } });
        resolvedFarmId = farm?.id ?? null;
      }

      console.log('[Sync] UPSERT_REMINDER', { id: reminder.id, title: reminder.title, userId });
      await prisma.reminder.create({
        data: {
          id:          reminder.id,
          userId,
          title:       reminder.title,
          scheduledAt: new Date(reminder.scheduledAt),
          cropId:      reminder.cropId     ?? null,
          farmId:      resolvedFarmId,
          recurrence:  reminder.recurrence ?? null,
          isCompleted: reminder.isCompleted ?? false,
          ...(reminder.createdAt ? { createdAt: new Date(reminder.createdAt) } : {}),
        },
      });
      result.syncedCounts.reminders++;
      console.log('[Sync] REMINDER_INSERTED', { id: reminder.id, userId });
    } catch (e) {
      console.error('[Sync] REMINDER_ERROR', { id: reminder.id, error: (e as Error).message });
      result.conflicts.push(`Reminder ${reminder.id}: failed to sync`);
    }
  }

  // ── Update lastSyncAt ──────────────────────────────────────────────────────
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
