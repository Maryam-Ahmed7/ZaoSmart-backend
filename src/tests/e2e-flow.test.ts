/**
 * ZaoSmart E2E Integration Test
 *
 * Simulates a complete user journey from registration through to subscription,
 * covering every major module in a realistic offline-first agricultural flow.
 *
 * Run with: npm run test:e2e
 */
import 'dotenv/config';
import assert from 'assert';
import http from 'http';
import { randomUUID } from 'crypto';
import app from '../app';
import { prisma } from '../prisma';

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const g  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const r  = (s: string) => `\x1b[31m${s}\x1b[0m`;
const b  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const d  = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cy = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
type ApiResponse = { status: number; body: Record<string, unknown> };

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<ApiResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json as Record<string, unknown> };
}

// ─── Narrative step runner ────────────────────────────────────────────────────
let stepsPassed = 0;
let stepsFailed = 0;

async function step(description: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ${g('✓')} ${description}`);
    stepsPassed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${r('✗')} ${description}`);
    console.log(`    ${d(msg)}`);
    stepsFailed++;
  }
}

function scene(title: string): void {
  console.log(`\n${cy(b(`▸ ${title}`))}`);
}

// ─── Journey ──────────────────────────────────────────────────────────────────
async function runJourney(email: string): Promise<void> {
  // Shared state across scenes (mirrors what a mobile client would persist)
  const password   = 'Secure@E2E99';
  const deviceName = 'iPhone 14 Pro (test)';
  let accessToken  = '';
  let deviceId     = '';
  let userId       = '';
  let farmId       = '';
  let scanId       = '';
  let reminderId   = '';
  let diseaseId    = '';

  // ── Scene 1: Authentication ──────────────────────────────────────────────────
  scene('Scene 1: A new farmer registers and authenticates');

  await step('Farmer registers a new account', async () => {
    const res = await api('POST', '/auth/register', { email, password, deviceName });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.ok(res.body.accessToken, 'Missing accessToken');
    assert.ok(res.body.deviceId,    'Missing deviceId');
    assert.ok((res.body.user as Record<string, unknown>)?.id, 'Missing user.id');
    accessToken = res.body.accessToken as string;
    deviceId    = res.body.deviceId as string;
    userId      = (res.body.user as Record<string, unknown>).id as string;
  });

  await step('Login from a second device returns a fresh token pair', async () => {
    const res = await api('POST', '/auth/login', { email, password, deviceName: 'Android Tablet (test)' });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(res.body.accessToken,  'Missing accessToken');
    assert.ok(res.body.refreshToken, 'Missing refreshToken');
    assert.notStrictEqual(res.body.deviceId, deviceId, 'New login should produce a new deviceId');
  });

  await step('Access token grants authenticated identity via /auth/me', async () => {
    const res = await api('GET', '/auth/me', undefined, accessToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.email, email, 'Returned wrong user email');
    assert.ok(!(res.body as Record<string, unknown>).passwordHash, 'passwordHash must never be exposed');
  });

  await step('Unauthenticated request is rejected with 401', async () => {
    const res = await api('GET', '/auth/me');
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
  });

  // ── Scene 2: Farm Setup ──────────────────────────────────────────────────────
  scene('Scene 2: Farmer creates and retrieves their farm');

  await step('Farmer creates a maize farm in Rift Valley', async () => {
    const res = await api('POST', '/farms', {
      name:        'Kilimo Shamba',
      cropType:    'maize',
      region:      'Rift Valley',
      size:        3.5,
      plantingDate: new Date().toISOString(),
    }, accessToken);
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.name,     'Kilimo Shamba');
    assert.strictEqual(res.body.cropType, 'maize');
    assert.strictEqual(res.body.userId,   userId);
    farmId = res.body.id as string;
  });

  await step('Farm is retrievable with all persisted fields intact', async () => {
    const res = await api('GET', `/farms/${farmId}`, undefined, accessToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.id,     farmId);
    assert.strictEqual(res.body.region, 'Rift Valley');
    assert.strictEqual(res.body.size,   3.5);
  });

  await step('Another user cannot access this farm (ownership enforced)', async () => {
    const other = await api('POST', '/auth/register', {
      email: `e2e_other_${Date.now()}@zaosmart.dev`,
      password, deviceName: 'Other Device',
    });
    const otherToken = other.body.accessToken as string;
    const res = await api('GET', `/farms/${farmId}`, undefined, otherToken);
    assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
    // Cleanup other user
    await prisma.user.deleteMany({ where: { email: (other.body.user as Record<string, unknown>).email as string } });
  });

  // ── Scene 3: AI Scan with Disease Detection ──────────────────────────────────
  scene('Scene 3: Mobile AI scan — backend resolves disease automatically');

  await step('Disease knowledge base seeded with Northern Leaf Blight', async () => {
    const res = await api('POST', '/diseases', {
      name:        'Northern Leaf Blight',
      description: 'Fungal disease caused by Exserohilum turcicum',
      cropType:    'maize',
      severity:    'high',
      symptoms:    'Long, elliptical, grayish-green lesions on leaves',
      treatment:   'Apply fungicide; use resistant hybrids',
    }, accessToken);
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    diseaseId = res.body.id as string;
  });

  await step('Scan created — backend auto-links disease from AI prediction string', async () => {
    const res = await api('POST', '/scans', {
      imageUrl:         'device://local/scan_leaf_001.jpg',
      cropType:         'maize',
      farmId,
      predictedDisease: 'Northern Leaf Blight',
      confidence:       0.94,
      notes:            'Lower leaves affected after recent rain',
    }, accessToken);
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.diseaseId, diseaseId, 'diseaseId not auto-linked');
    assert.ok(res.body.disease, 'Disease object missing from response');
    scanId = res.body.id as string;
  });

  await step('GET /scans/:id returns enriched scan with full disease details', async () => {
    const res = await api('GET', `/scans/${scanId}`, undefined, accessToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const disease = res.body.disease as Record<string, unknown>;
    assert.ok(disease,                  'disease object missing');
    assert.ok(disease.symptoms,         'disease.symptoms missing');
    assert.ok(disease.treatment,        'disease.treatment missing');
    assert.strictEqual(disease.severity, 'high');
    assert.strictEqual(res.body.confidence, 0.94);
  });

  await step('Scan without matching disease name stores null diseaseId gracefully', async () => {
    const res = await api('POST', '/scans', {
      imageUrl: 'device://local/scan_unknown_001.jpg',
      cropType: 'maize',
      predictedDisease: 'Unknown Pathogen v2.1',
    }, accessToken);
    assert.strictEqual(res.status, 201,  `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.diseaseId, null, 'diseaseId should be null when no match');
  });

  // ── Scene 4: Offline Batch Sync ──────────────────────────────────────────────
  scene('Scene 4: Mobile reconnects — uploads offline batch via sync engine');

  const offlineFarm1Id = randomUUID();
  const offlineFarm2Id = randomUUID();
  const offlineScan1Id = randomUUID();
  const offlineScan2Id = randomUUID();
  const offlineScan3Id = randomUUID();

  const syncPayload = {
    deviceId,
    farms: [
      { id: offlineFarm1Id, name: 'Offline Farm A', cropType: 'potato', region: 'Central' },
      { id: offlineFarm2Id, name: 'Offline Farm B', cropType: 'coffee', size: 1.2 },
    ],
    scans: [
      {
        id: offlineScan1Id, imageUrl: 'offline/potato_scan.jpg', cropType: 'potato',
        farmId: offlineFarm1Id, confidence: 0.78,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: offlineScan2Id, imageUrl: 'offline/coffee_scan.jpg', cropType: 'coffee',
        farmId: offlineFarm2Id,
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: offlineScan3Id, imageUrl: 'offline/maize_blight_scan.jpg', cropType: 'maize',
        predictedDisease: 'Northern Leaf Blight',
        createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
    ],
  };

  await step('Offline batch of 2 farms + 3 scans uploads successfully', async () => {
    const res = await api('POST', '/sync/upload', syncPayload, accessToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const counts = res.body.syncedCounts as Record<string, number>;
    assert.strictEqual(counts.farms, 2, `Expected 2 farms synced, got ${counts.farms}`);
    assert.strictEqual(counts.scans, 3, `Expected 3 scans synced, got ${counts.scans}`);
    assert.ok(Array.isArray(res.body.conflicts), 'conflicts should be an array');
    assert.strictEqual((res.body.conflicts as unknown[]).length, 0, 'No conflicts expected');
  });

  await step('Offline scans preserve client-supplied createdAt timestamps', async () => {
    const dbScan = await prisma.scan.findUnique({ where: { id: offlineScan1Id } });
    assert.ok(dbScan, 'Offline scan not found in DB');
    const savedAt = dbScan!.createdAt.getTime();
    const expected = new Date(syncPayload.scans[0].createdAt!).getTime();
    assert.ok(Math.abs(savedAt - expected) < 1000, 'createdAt not preserved from client');
  });

  await step('Cross-payload farm→scan linkage resolved correctly', async () => {
    const dbScan = await prisma.scan.findUnique({ where: { id: offlineScan1Id } });
    assert.strictEqual(dbScan?.farmId, offlineFarm1Id, 'Farm link not resolved from same-payload farm');
  });

  await step('Disease auto-linking works within sync upload', async () => {
    const dbScan = await prisma.scan.findUnique({ where: { id: offlineScan3Id } });
    assert.strictEqual(dbScan?.diseaseId, diseaseId, 'Disease not linked during sync');
  });

  await step('Re-sending identical payload is fully idempotent — zero duplicates', async () => {
    const res = await api('POST', '/sync/upload', syncPayload, accessToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const skipped = res.body.skipped as Record<string, number>;
    assert.strictEqual(skipped.farms, 2, `Expected 2 farms skipped, got ${skipped.farms}`);
    assert.strictEqual(skipped.scans, 3, `Expected 3 scans skipped, got ${skipped.scans}`);
    const synced = res.body.syncedCounts as Record<string, number>;
    assert.strictEqual(synced.farms, 0, 'Duplicate farms should not be created');
    assert.strictEqual(synced.scans, 0, 'Duplicate scans should not be created');
  });

  await step('Device lastSyncAt updated after successful upload', async () => {
    const statusRes = await api('GET', '/sync/status', undefined, accessToken);
    assert.strictEqual(statusRes.status, 200);
    const devices = statusRes.body.devices as Array<Record<string, unknown>>;
    const device  = devices.find(d => d.deviceId === deviceId);
    assert.ok(device,                'Device not found in sync status');
    assert.ok(device.lastSyncAt,     'lastSyncAt not set after upload');
  });

  // ── Scene 5: Reminders ───────────────────────────────────────────────────────
  scene('Scene 5: Farmer schedules a post-sync agricultural task');

  await step('Spraying reminder created and linked to the maize farm', async () => {
    const res = await api('POST', '/reminders', {
      title:       'Apply fungicide — Northern Leaf Blight prevention',
      type:        'spraying',
      date:        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      farmId,
      description: 'Triggered by scan confidence 0.94 — act within 72 hours',
    }, accessToken);
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.strictEqual(res.body.farmId,      farmId);
    assert.strictEqual(res.body.isCompleted, false);
    reminderId = res.body.id as string;
  });

  await step('Reminder retrieved with correct farm association', async () => {
    const res = await api('GET', `/reminders/${reminderId}`, undefined, accessToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.id,     reminderId);
    assert.strictEqual(res.body.farmId, farmId);
    assert.strictEqual(res.body.type,   'spraying');
  });

  await step('Reminder marked complete after task is done', async () => {
    const res = await api('PUT', `/reminders/${reminderId}`, { isCompleted: true }, accessToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.isCompleted, true);
  });

  // ── Scene 6: Subscription ────────────────────────────────────────────────────
  scene('Scene 6: Subscription and premium access layer');

  await step('New user starts on free plan — no DB record created', async () => {
    const res = await api('GET', '/subscription/me', undefined, accessToken);
    assert.strictEqual(res.status, 200,       `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.plan,   'free');
    assert.strictEqual(res.body.status, 'active');
    assert.strictEqual(res.body.expiryDate, null, 'Free plan should have no expiry');
    // Confirm no DB record exists
    const dbSub = await prisma.subscription.findUnique({ where: { userId } });
    assert.strictEqual(dbSub, null, 'Free plan should not create a DB record');
  });

  await step('Farmer upgrades to premium — 30-day subscription activated', async () => {
    const res = await api('POST', '/subscription/activate', {}, accessToken);
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.plan,   'premium');
    assert.strictEqual(res.body.status, 'active');
    assert.ok(res.body.expiryDate, 'expiryDate should be set for premium');
    const expiry = new Date(res.body.expiryDate as string).getTime();
    const days   = (expiry - Date.now()) / (1000 * 60 * 60 * 24);
    assert.ok(days > 29 && days <= 31, `Expected ~30 days, got ${days.toFixed(1)}`);
  });

  await step('/subscription/me now reflects premium status', async () => {
    const res = await api('GET', '/subscription/me', undefined, accessToken);
    assert.strictEqual(res.body.plan,     'premium');
    assert.strictEqual(res.body.isActive, true);
  });

  await step('Re-activating resets the 30-day window without error', async () => {
    const res = await api('POST', '/subscription/activate', {}, accessToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.plan, 'premium');
  });

  await step('Farmer cancels subscription — access deactivated cleanly', async () => {
    const res = await api('POST', '/subscription/cancel', {}, accessToken);
    assert.strictEqual(res.status, 200,        `Expected 200, got ${res.status}`);
    assert.strictEqual(res.body.status,   'cancelled');
    assert.strictEqual(res.body.isActive, false);
    assert.strictEqual(res.body.plan,     'premium', 'Plan should remain premium (for history)');
  });

  await step('Cancelling again returns 400 — double cancel prevented', async () => {
    const res = await api('POST', '/subscription/cancel', {}, accessToken);
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  console.log(b('\n╔═ ZaoSmart E2E Integration Test ═══════════════════════════╗'));
  console.log(d(`Server started on port ${PORT} — simulating full user journey…`));

  const testEmail = `e2e_${Date.now()}@zaosmart.dev`;

  try {
    await runJourney(testEmail);
  } finally {
    // Cascade-delete all e2e test users and their data
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e_' } },
    });
    // Clean up any diseases created by this run (global, not user-scoped)
    await prisma.disease.deleteMany({
      where: { name: 'Northern Leaf Blight' },
    });
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\n${'─'.repeat(60)}`);
  if (stepsFailed === 0) {
    console.log(g(b(`✓  All ${stepsPassed} journey steps passed — ZaoSmart is production-ready.`)));
  } else {
    console.log(r(b(`✗  ${stepsFailed} step(s) failed  |  ${stepsPassed} passed.`)));
    console.log(r('   Review the failures above before deployment.'));
    process.exitCode = 1;
  }
  console.log();
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error(r('\nFatal error in E2E runner:'), err);
  process.exit(1);
});
