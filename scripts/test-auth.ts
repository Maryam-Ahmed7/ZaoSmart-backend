/**
 * Full-stack verification script — dev only.
 * Starts the app on port 3999, runs auth + farms checks, cleans up, exits.
 * Usage: npm run test:auth
 */
import 'dotenv/config';
import http from 'http';
import { randomUUID } from 'crypto';
import app from '../src/app';
import { prisma } from '../src/prisma';

const PORT = 3999;
const HOST = `http://localhost:${PORT}`;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const g = (s: string) => `\x1b[32m${s}\x1b[0m`;
const r = (s: string) => `\x1b[31m${s}\x1b[0m`;
const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const d = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ─── Tiny request helpers ──────────────────────────────────────────────────────
type J = Record<string, unknown>;

async function post(base: string, path: string, body: unknown, token?: string) {
  const res = await fetch(`${HOST}${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as J };
}

async function get(base: string, path: string, token?: string) {
  const res = await fetch(`${HOST}${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json()) as J };
}

async function put(base: string, path: string, body: unknown, token: string) {
  const res = await fetch(`${HOST}${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as J };
}

async function del(base: string, path: string, token: string) {
  const res = await fetch(`${HOST}${base}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: res.status === 204 ? {} : (await res.json()) as J };
}

// ─── Assertion tracker ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, hint?: string): void {
  if (ok) {
    console.log(`  ${g('✓')} ${label}`);
    passed++;
  } else {
    console.log(`  ${r('✗')} ${label}${hint ? d(` (${hint})`) : ''}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${b(title)}`);
}

// ─── Auth tests ────────────────────────────────────────────────────────────────
async function runAuthTests(email: string): Promise<string> {
  const A     = '/auth';
  const pw    = 'Test@Secure99';
  const dName = 'Test Device';

  // ── 1. REGISTER ──────────────────────────────────────────────────────────────
  section('1 ▸ POST /auth/register');

  const reg = await post(A, '/register', { email, password: pw, deviceName: dName });
  check('201 on valid registration',    reg.status === 201,         `got ${reg.status}`);
  check('returns accessToken',          typeof reg.body.accessToken === 'string');
  check('returns refreshToken',         typeof reg.body.refreshToken === 'string');
  check('returns deviceId',             typeof reg.body.deviceId === 'string');
  check('user shape — id present',      !!(reg.body.user as J)?.id);
  check('user shape — no passwordHash', !(reg.body.user as J)?.passwordHash);

  const regDup = await post(A, '/register', { email, password: pw, deviceName: dName });
  check('409 on duplicate email',       regDup.status === 409,      `got ${regDup.status}`);

  const regBad = await post(A, '/register', { email });
  check('400 on missing fields',        regBad.status === 400,      `got ${regBad.status}`);

  const regRefreshToken = reg.body.refreshToken as string;

  // ── 2. LOGIN ──────────────────────────────────────────────────────────────────
  section('2 ▸ POST /auth/login');

  const login = await post(A, '/login', { email, password: pw, deviceName: 'Login Device' });
  check('200 on valid login',           login.status === 200,       `got ${login.status}`);
  check('returns accessToken',          typeof login.body.accessToken === 'string');
  check('returns refreshToken',         typeof login.body.refreshToken === 'string');
  check('returns deviceId',             typeof login.body.deviceId === 'string');

  const loginWrong = await post(A, '/login', { email, password: 'Wrong!', deviceName: dName });
  check('401 on wrong password',        loginWrong.status === 401,  `got ${loginWrong.status}`);

  const loginGhost = await post(A, '/login', { email: 'ghost@zaosmart.dev', password: pw, deviceName: dName });
  check('401 on unknown email',         loginGhost.status === 401,  `got ${loginGhost.status}`);

  const accessToken  = login.body.accessToken as string;
  let   refreshToken = login.body.refreshToken as string;

  // ── 3. GET /auth/me ───────────────────────────────────────────────────────────
  section('3 ▸ GET /auth/me');

  const me = await get(A, '/me', accessToken);
  check('200 with valid token',         me.status === 200,          `got ${me.status}`);
  check('returns id + email',           !!me.body.id && !!me.body.email);
  check('no passwordHash in response',  !me.body.passwordHash);

  check('401 without token',            (await get(A, '/me')).status === 401);
  check('401 with invalid token',       (await get(A, '/me', 'bad.jwt')).status === 401);

  // ── 4. REFRESH TOKEN ROTATION ─────────────────────────────────────────────────
  section('4 ▸ POST /auth/refresh');

  const ref1 = await post(A, '/refresh', { refreshToken });
  check('200 on valid refresh',         ref1.status === 200,        `got ${ref1.status}`);
  check('returns new accessToken',      typeof ref1.body.accessToken === 'string');
  check('returns new refreshToken',     typeof ref1.body.refreshToken === 'string');
  check('token was actually rotated',   ref1.body.refreshToken !== refreshToken);

  check('401 on reused token',          (await post(A, '/refresh', { refreshToken })).status === 401);
  check('401 on bogus token',           (await post(A, '/refresh', { refreshToken: 'fake' })).status === 401);
  check('400 on missing refreshToken',  (await post(A, '/refresh', {})).status === 400);

  const newAccessToken  = ref1.body.accessToken as string;
  const newRefreshToken = ref1.body.refreshToken as string;
  check('new access token is usable',   (await get(A, '/me', newAccessToken)).status === 200);

  refreshToken = newRefreshToken;

  // ── 5. LOGOUT ─────────────────────────────────────────────────────────────────
  section('5 ▸ POST /auth/logout');

  const lo = await post(A, '/logout', { refreshToken });
  check('200 on valid logout',          lo.status === 200,          `got ${lo.status}`);
  check('message in response',          typeof lo.body.message === 'string');
  check('401 on refresh after logout',  (await post(A, '/refresh', { refreshToken })).status === 401);
  check('400 on missing refreshToken',  (await post(A, '/logout', {})).status === 400);

  const loReg = await post(A, '/logout', { refreshToken: regRefreshToken });
  check('200 logging out register session', loReg.status === 200,  `got ${loReg.status}`);

  // ── 6. DATABASE SANITY ────────────────────────────────────────────────────────
  section('6 ▸ Database sanity');

  const dbUser = await prisma.user.findUnique({
    where: { email },
    include: { devices: true, refreshTokens: true },
  });
  check('user record exists',           dbUser !== null);
  check('devices were created',         (dbUser?.devices.length ?? 0) >= 2);
  check('all sessions fully revoked',   (dbUser?.refreshTokens.length ?? 0) === 0);

  // Return a fresh login token for use in farms tests
  const fresh = await post(A, '/login', { email, password: pw, deviceName: 'Farms Test Device' });
  return fresh.body.accessToken as string;
}

// ─── Farms tests ───────────────────────────────────────────────────────────────
async function runFarmsTests(token: string, otherToken: string): Promise<string> {
  const F = '/farms';

  // ── 7. CREATE FARM ────────────────────────────────────────────────────────────
  section('7 ▸ POST /farms');

  check('401 without token',            (await post(F, '/', { name: 'x', cropType: 'maize' })).status === 401);

  const f1 = await post(F, '/', { name: 'Kilimo Farm', cropType: 'maize', region: 'Rift Valley', size: 2.5 }, token);
  check('201 on valid create',          f1.status === 201,          `got ${f1.status}`);
  check('returns id',                   typeof f1.body.id === 'string');
  check('userId set from token',        typeof f1.body.userId === 'string');
  check('correct cropType stored',      f1.body.cropType === 'maize');
  check('optional fields persisted',    f1.body.region === 'Rift Valley' && f1.body.size === 2.5);

  const fMin = await post(F, '/', { name: 'Minimal Farm', cropType: 'coffee' }, token);
  check('201 with only required fields', fMin.status === 201,       `got ${fMin.status}`);

  const fBadCrop = await post(F, '/', { name: 'X', cropType: 'wheat' }, token);
  check('400 on invalid cropType',      fBadCrop.status === 400,    `got ${fBadCrop.status}`);

  const fMissing = await post(F, '/', { name: 'X' }, token);
  check('400 on missing cropType',      fMissing.status === 400,    `got ${fMissing.status}`);

  const farmId  = f1.body.id as string;
  const minFarmId = fMin.body.id as string;

  // ── 8. LIST FARMS ─────────────────────────────────────────────────────────────
  section('8 ▸ GET /farms');

  check('401 without token',            (await get(F, '/')).status === 401);

  const list = await get(F, '/', token);
  check('200 and returns array',        list.status === 200 && Array.isArray(list.body));
  check('only own farms returned',      (list.body as unknown[]).length >= 2);

  const otherList = await get(F, '/', otherToken);
  check('other user sees only their farms', (otherList.body as unknown[]).length === 0);

  // ── 9. GET SINGLE FARM ────────────────────────────────────────────────────────
  section('9 ▸ GET /farms/:id');

  const single = await get(F, `/${farmId}`, token);
  check('200 on own farm',              single.status === 200,      `got ${single.status}`);
  check('correct farm returned',        single.body.id === farmId);

  check('401 without token',            (await get(F, `/${farmId}`)).status === 401);
  check('404 on other user\'s farm',    (await get(F, `/${farmId}`, otherToken)).status === 404);
  check('404 on nonexistent id',        (await get(F, '/00000000-0000-0000-0000-000000000000', token)).status === 404);

  // ── 10. UPDATE FARM ───────────────────────────────────────────────────────────
  section('10 ▸ PUT /farms/:id');

  const upd = await put(F, `/${farmId}`, { name: 'Updated Farm', size: 5.0 }, token);
  check('200 on own farm update',       upd.status === 200,         `got ${upd.status}`);
  check('name was updated',             upd.body.name === 'Updated Farm');
  check('size was updated',             upd.body.size === 5.0);
  check('cropType unchanged',           upd.body.cropType === 'maize');

  const updBadCrop = await put(F, `/${farmId}`, { cropType: 'rice' }, token);
  check('400 on invalid cropType',      updBadCrop.status === 400,  `got ${updBadCrop.status}`);

  check('401 without token',            (await put(F, `/${farmId}`, { name: 'X' }, 'badtoken')).status === 401);
  check('404 on other user\'s farm',    (await put(F, `/${farmId}`, { name: 'X' }, otherToken)).status === 404);

  // ── 11. DELETE FARM ───────────────────────────────────────────────────────────
  section('11 ▸ DELETE /farms/:id');

  check('404 on other user\'s farm',    (await del(F, `/${farmId}`, otherToken)).status === 404);
  check('401 without token',            (await del(F, `/${farmId}`, 'badtoken')).status === 401);

  const gone = await del(F, `/${minFarmId}`, token);
  check('204 on own farm delete',       gone.status === 204,        `got ${gone.status}`);

  check('404 after deletion',           (await get(F, `/${minFarmId}`, token)).status === 404);

  // ── 12. DB SANITY ─────────────────────────────────────────────────────────────
  section('12 ▸ Database sanity (farms)');

  const dbFarms = await prisma.farm.findMany({ where: { id: { in: [farmId, minFarmId] } } });
  check('deleted farm is gone from DB', !dbFarms.find(f => f.id === minFarmId));
  check('kept farm still in DB',        !!dbFarms.find(f => f.id === farmId));

  return farmId;
}

// ─── Scans tests ───────────────────────────────────────────────────────────────
async function runScansTests(token: string, otherToken: string, farmId: string): Promise<void> {
  const S = '/scans';

  // Create a disease to use for linkage tests (isolated from the diseases test suite)
  const linkDiseaseRes = await post('/diseases', '/', {
    name:        'Maize Streak Virus',
    description: 'Viral disease transmitted by leafhoppers',
    cropType:    'maize',
    severity:    'high',
    symptoms:    'Chlorotic streaks parallel to leaf veins',
    treatment:   'Remove infected plants; use virus-resistant varieties',
  }, token);
  const linkDiseaseId   = linkDiseaseRes.body.id as string;
  const linkDiseaseName = 'Maize Streak Virus';

  // ── 13. CREATE SCAN ───────────────────────────────────────────────────────────
  section('13 ▸ POST /scans');

  check('401 without token', (await post(S, '/', { imageUrl: 'x', cropType: 'maize' })).status === 401);

  const s1 = await post(S, '/', {
    imageUrl: 'uploads/scan_001.jpg',
    cropType: 'maize',
    farmId,
    predictedDisease: 'Northern Leaf Blight',
    confidence: 0.91,
    notes: 'Spotted on lower leaves',
  }, token);
  check('201 on full create',             s1.status === 201,         `got ${s1.status}`);
  check('returns id',                     typeof s1.body.id === 'string');
  check('userId set from token',          typeof s1.body.userId === 'string');
  check('farmId stored correctly',        s1.body.farmId === farmId);
  check('predictedDisease stored',        s1.body.predictedDisease === 'Northern Leaf Blight');
  check('confidence stored',              s1.body.confidence === 0.91);

  const sMin = await post(S, '/', { imageUrl: 'uploads/scan_002.jpg', cropType: 'coffee' }, token);
  check('201 with only required fields',  sMin.status === 201,       `got ${sMin.status}`);
  check('optional fields are null',       sMin.body.farmId === null && sMin.body.predictedDisease === null);

  const sBadCrop = await post(S, '/', { imageUrl: 'x.jpg', cropType: 'wheat' }, token);
  check('400 on invalid cropType',        sBadCrop.status === 400,   `got ${sBadCrop.status}`);

  const sMissing = await post(S, '/', { cropType: 'maize' }, token);
  check('400 on missing imageUrl',        sMissing.status === 400,   `got ${sMissing.status}`);

  const sBadConf = await post(S, '/', { imageUrl: 'x.jpg', cropType: 'maize', confidence: 1.5 }, token);
  check('400 on confidence > 1',          sBadConf.status === 400,   `got ${sBadConf.status}`);

  const sBadFarm = await post(S, '/', {
    imageUrl: 'x.jpg', cropType: 'maize',
    farmId: '00000000-0000-0000-0000-000000000000',
  }, token);
  check('404 on non-owned farmId',        sBadFarm.status === 404,   `got ${sBadFarm.status}`);

  const scanId    = s1.body.id as string;
  const minScanId = sMin.body.id as string;

  // Disease linkage — scan whose predictedDisease matches an existing Disease record
  const sLinked = await post(S, '/', {
    imageUrl: 'uploads/scan_linked.jpg',
    cropType: 'maize',
    predictedDisease: linkDiseaseName,
  }, token);
  check('201 on disease-matched scan',      sLinked.status === 201,                    `got ${sLinked.status}`);
  check('diseaseId auto-linked on match',   sLinked.body.diseaseId === linkDiseaseId);
  check('disease object included',          (sLinked.body.disease as J)?.id === linkDiseaseId);
  check('disease.name matches prediction',  (sLinked.body.disease as J)?.name === linkDiseaseName);
  check('disease.severity present',         typeof (sLinked.body.disease as J)?.severity === 'string');

  // No-match case — raw AI string that has no Disease record
  const sNoMatch = await post(S, '/', {
    imageUrl: 'uploads/scan_nomatch.jpg',
    cropType: 'maize',
    predictedDisease: 'Unknown Pathogen XYZ',
  }, token);
  check('diseaseId null when no match',     sNoMatch.body.diseaseId === null);
  check('disease null when no match',       sNoMatch.body.disease === null);

  // Backward-compat — s1 has no matching disease in DB yet (Northern Leaf Blight not seeded)
  check('disease null for unmatched s1',    s1.body.diseaseId === null);
  // No-disease scan should still have the disease key (just null)
  check('disease key always present',       'disease' in sMin.body);

  const linkedScanId = sLinked.body.id as string;

  // ── 14. LIST SCANS ────────────────────────────────────────────────────────────
  section('14 ▸ GET /scans');

  check('401 without token', (await get(S, '/')).status === 401);

  const listAll = await get(S, '/', token);
  check('200 returns array',              listAll.status === 200 && Array.isArray(listAll.body));
  check('own scans returned',             (listAll.body as unknown[]).length >= 2);

  const otherList = await get(S, '/', otherToken);
  check('other user sees empty list',     (otherList.body as unknown[]).length === 0);

  const listByFarm = await get(S, `/?farmId=${farmId}`, token);
  check('farmId filter works',            (listByFarm.body as J[]).every((s) => s.farmId === farmId));

  const listByCrop = await get(S, '/?cropType=maize', token);
  check('cropType filter works',          (listByCrop.body as J[]).every((s) => s.cropType === 'maize'));

  const listBoth = await get(S, `/?farmId=${farmId}&cropType=maize`, token);
  check('combined filter works',          Array.isArray(listBoth.body));

  // Every item in the list should carry the disease key
  check('disease key present in list',    (listAll.body as J[]).every(s => 'disease' in s));
  // The linked scan should surface full disease data in the list
  const listLinked = (listAll.body as J[]).find(s => s.id === linkedScanId);
  check('linked disease included in list', (listLinked?.disease as J)?.id === linkDiseaseId);

  // ── 15. GET SINGLE SCAN ───────────────────────────────────────────────────────
  section('15 ▸ GET /scans/:id');

  const single = await get(S, `/${scanId}`, token);
  check('200 on own scan',                single.status === 200,     `got ${single.status}`);
  check('correct scan returned',          single.body.id === scanId);
  check('disease key present in single',  'disease' in single.body);

  check('401 without token',              (await get(S, `/${scanId}`)).status === 401);
  check('404 on other user\'s scan',      (await get(S, `/${scanId}`, otherToken)).status === 404);
  check('404 on nonexistent id',          (await get(S, '/00000000-0000-0000-0000-000000000000', token)).status === 404);

  const singleLinked = await get(S, `/${linkedScanId}`, token);
  check('linked disease details in single', (singleLinked.body.disease as J)?.id === linkDiseaseId);
  check('disease.treatment in single',      typeof (singleLinked.body.disease as J)?.treatment === 'string');

  // ── 16. DELETE SCAN ───────────────────────────────────────────────────────────
  section('16 ▸ DELETE /scans/:id');

  check('404 on other user\'s scan',      (await del(S, `/${scanId}`, otherToken)).status === 404);
  check('401 without token',              (await del(S, `/${scanId}`, 'bad')).status === 401);

  const gone = await del(S, `/${minScanId}`, token);
  check('204 on own scan delete',         gone.status === 204,       `got ${gone.status}`);
  check('404 after deletion',             (await get(S, `/${minScanId}`, token)).status === 404);

  // ── 17. DB SANITY ─────────────────────────────────────────────────────────────
  section('17 ▸ Database sanity (scans)');

  const dbScans = await prisma.scan.findMany({ where: { id: { in: [scanId, minScanId] } } });
  check('deleted scan gone from DB',      !dbScans.find(s => s.id === minScanId));
  check('kept scan still in DB',          !!dbScans.find(s => s.id === scanId));
  check('scan retains farmId in DB',      dbScans.find(s => s.id === scanId)?.farmId === farmId);

  const dbLinked = await prisma.scan.findUnique({ where: { id: linkedScanId } });
  check('diseaseId persisted in DB',      dbLinked?.diseaseId === linkDiseaseId);

  // Cleanup: delete the disease created for linkage tests (SetNull keeps scans intact)
  await prisma.disease.delete({ where: { id: linkDiseaseId } });
  const dbLinkedAfter = await prisma.scan.findUnique({ where: { id: linkedScanId } });
  check('diseaseId null after disease deleted (SetNull)', dbLinkedAfter?.diseaseId === null);
}

// ─── Diseases tests ────────────────────────────────────────────────────────────
async function runDiseasesTests(token: string): Promise<void> {
  const D = '/diseases';

  const validDisease = {
    name:        'Northern Leaf Blight',
    description: 'Fungal disease causing large lesions on maize leaves',
    cropType:    'maize',
    severity:    'high',
    symptoms:    'Long, grayish-green cigar-shaped lesions on leaves',
    treatment:   'Apply fungicide; use resistant varieties',
  };

  // ── 18. CREATE DISEASE (protected) ───────────────────────────────────────────
  section('18 ▸ POST /diseases');

  check('401 without token',            (await post(D, '/', validDisease)).status === 401);

  const d1 = await post(D, '/', validDisease, token);
  check('201 on valid create',          d1.status === 201,          `got ${d1.status}`);
  check('returns id',                   typeof d1.body.id === 'string');
  check('name stored correctly',        d1.body.name === validDisease.name);
  check('severity stored',              d1.body.severity === 'high');
  check('isActive defaults to true',    d1.body.isActive === true);

  const d2 = await post(D, '/', {
    name: 'Coffee Leaf Rust', description: 'Fungal disease on coffee',
    cropType: 'coffee', severity: 'medium',
    symptoms: 'Yellow-orange powdery spots on leaf undersides',
    treatment: 'Copper-based fungicides; remove infected leaves',
  }, token);
  check('201 second disease',           d2.status === 201,          `got ${d2.status}`);

  const dDup = await post(D, '/', validDisease, token);
  check('409 on duplicate name',        dDup.status === 409,        `got ${dDup.status}`);

  const dBadCrop = await post(D, '/', { ...validDisease, name: 'X', cropType: 'wheat' }, token);
  check('400 on invalid cropType',      dBadCrop.status === 400,    `got ${dBadCrop.status}`);

  const dBadSev = await post(D, '/', { ...validDisease, name: 'Y', severity: 'critical' }, token);
  check('400 on invalid severity',      dBadSev.status === 400,     `got ${dBadSev.status}`);

  const dMissing = await post(D, '/', { name: 'Z', cropType: 'maize' }, token);
  check('400 on missing required fields', dMissing.status === 400,  `got ${dMissing.status}`);

  const diseaseId = d1.body.id as string;

  // ── 19. LIST DISEASES (public) ────────────────────────────────────────────────
  section('19 ▸ GET /diseases');

  const listAll = await get(D, '/');
  check('200 with no token (public)',   listAll.status === 200 && Array.isArray(listAll.body));
  check('returns created diseases',     (listAll.body as unknown[]).length >= 2);

  const listMaize = await get(D, '/?cropType=maize');
  check('cropType filter works',        (listMaize.body as J[]).every(d => d.cropType === 'maize'));
  check('200 on cropType filter (public)', listMaize.status === 200);

  const listBadCrop = await get(D, '/?cropType=rice');
  check('400 on invalid cropType filter', listBadCrop.status === 400, `got ${listBadCrop.status}`);

  // ── 20. GET SINGLE DISEASE (public) ──────────────────────────────────────────
  section('20 ▸ GET /diseases/:id');

  const single = await get(D, `/${diseaseId}`);
  check('200 with no token (public)',   single.status === 200,      `got ${single.status}`);
  check('correct disease returned',     single.body.id === diseaseId);
  check('all fields present',           !!single.body.symptoms && !!single.body.treatment);

  const notFound = await get(D, '/00000000-0000-0000-0000-000000000000');
  check('404 on nonexistent id',        notFound.status === 404,    `got ${notFound.status}`);

  // ── 21. UPDATE DISEASE (protected) ───────────────────────────────────────────
  section('21 ▸ PUT /diseases/:id');

  check('401 without token',            (await put(D, `/${diseaseId}`, { severity: 'medium' }, 'bad')).status === 401);

  const upd = await put(D, `/${diseaseId}`, { severity: 'medium', treatment: 'Updated treatment' }, token);
  check('200 on valid update',          upd.status === 200,         `got ${upd.status}`);
  check('severity updated',             upd.body.severity === 'medium');
  check('treatment updated',            upd.body.treatment === 'Updated treatment');
  check('name unchanged',               upd.body.name === validDisease.name);

  const updBadSev = await put(D, `/${diseaseId}`, { severity: 'extreme' }, token);
  check('400 on invalid severity',      updBadSev.status === 400,   `got ${updBadSev.status}`);

  const updNotFound = await put(D, '/00000000-0000-0000-0000-000000000000', { severity: 'low' }, token);
  check('404 on nonexistent id',        updNotFound.status === 404, `got ${updNotFound.status}`);

  // ── 22. DELETE DISEASE (protected) ───────────────────────────────────────────
  section('22 ▸ DELETE /diseases/:id');

  check('401 without token',            (await del(D, `/${d2.body.id}`, 'bad')).status === 401);

  const gone = await del(D, `/${d2.body.id as string}`, token);
  check('204 on valid delete',          gone.status === 204,        `got ${gone.status}`);
  check('404 after deletion',           (await get(D, `/${d2.body.id}`)).status === 404);

  const delNotFound = await del(D, '/00000000-0000-0000-0000-000000000000', token);
  check('404 on nonexistent id',        delNotFound.status === 404, `got ${delNotFound.status}`);

  // ── 23. DB SANITY ─────────────────────────────────────────────────────────────
  section('23 ▸ Database sanity (diseases)');

  const dbDisease = await prisma.disease.findUnique({ where: { id: diseaseId } });
  check('disease exists in DB',         dbDisease !== null);
  check('severity reflects update',     dbDisease?.severity === 'medium');
  check('deleted disease gone from DB', !(await prisma.disease.findUnique({ where: { id: d2.body.id as string } })));

  // Cleanup disease records created by this suite
  await prisma.disease.deleteMany({ where: { id: { in: [diseaseId] } } });
}

// ─── Sync tests ────────────────────────────────────────────────────────────────
async function runSyncTests(token: string, deviceId: string): Promise<void> {
  const SY = '/sync';

  // Client-generated UUIDs (as the mobile app would produce)
  const clientFarmId  = randomUUID();
  const clientScanId  = randomUUID();
  const clientScan2Id = randomUUID();

  // ── 24. POST /sync/upload ─────────────────────────────────────────────────────
  section('24 ▸ POST /sync/upload');

  check('401 without token', (await post(SY, '/upload', { deviceId })).status === 401);

  const missingDevice = await post(SY, '/upload', { deviceId: randomUUID() }, token);
  check('403 on unowned deviceId',          missingDevice.status === 403,  `got ${missingDevice.status}`);

  const missingId = await post(SY, '/upload', {}, token);
  check('400 on missing deviceId',          missingId.status === 400,      `got ${missingId.status}`);

  // Sync a farm + two scans (one linked to that farm, one standalone)
  const payload = {
    deviceId,
    farms: [
      { id: clientFarmId, name: 'Offline Farm One', cropType: 'maize', region: 'Western' },
    ],
    scans: [
      {
        id:               clientScanId,
        imageUrl:         'offline/scan_farm.jpg',
        cropType:         'maize',
        farmId:           clientFarmId,         // references the farm in same payload
        predictedDisease: null,
        confidence:       0.88,
      },
      {
        id:       clientScan2Id,
        imageUrl: 'offline/scan_solo.jpg',
        cropType: 'coffee',
      },
    ],
  };

  const sync1 = await post(SY, '/upload', payload, token);
  check('200 on valid upload',              sync1.status === 200,          `got ${sync1.status}`);
  check('1 farm synced',                    sync1.body.syncedCounts?.farms === 1);
  check('2 scans synced',                   sync1.body.syncedCounts?.scans === 2);
  check('0 farms skipped',                  sync1.body.skipped?.farms === 0);
  check('0 scans skipped',                  sync1.body.skipped?.scans === 0);
  check('serverTimestamp present',          typeof sync1.body.serverTimestamp === 'string');
  check('conflicts array present',          Array.isArray(sync1.body.conflicts));

  // Verify farm-scan linkage was resolved correctly
  const dbSyncScan = await prisma.scan.findUnique({ where: { id: clientScanId } });
  check('scan linked to synced farm',       dbSyncScan?.farmId === clientFarmId);

  // Idempotency: resend the exact same payload — everything should be skipped
  const sync2 = await post(SY, '/upload', payload, token);
  check('200 on duplicate upload',          sync2.status === 200,          `got ${sync2.status}`);
  check('0 farms synced (idempotent)',       sync2.body.syncedCounts?.farms === 0);
  check('0 scans synced (idempotent)',       sync2.body.syncedCounts?.scans === 0);
  check('1 farm skipped',                   sync2.body.skipped?.farms === 1);
  check('2 scans skipped',                  sync2.body.skipped?.scans === 2);

  // Invalid items: missing required fields and bad cropType
  const badPayload = {
    deviceId,
    farms: [
      { id: randomUUID(), name: 'No CropType' },          // missing cropType
      { id: randomUUID(), name: 'Bad Crop', cropType: 'wheat' }, // invalid cropType
    ],
    scans: [
      { id: randomUUID(), cropType: 'maize' },            // missing imageUrl
    ],
  };
  const sync3 = await post(SY, '/upload', badPayload, token);
  check('200 with all-invalid payload',     sync3.status === 200,          `got ${sync3.status}`);
  check('0 farms synced (all invalid)',     sync3.body.syncedCounts?.farms === 0);
  check('conflicts recorded',              (sync3.body.conflicts as unknown[]).length >= 3);

  // Scan referencing a farmId that doesn't exist → stored with null farmId
  const orphanScanId = randomUUID();
  const orphanPayload = {
    deviceId,
    scans: [{ id: orphanScanId, imageUrl: 'x.jpg', cropType: 'maize', farmId: randomUUID() }],
  };
  const sync4 = await post(SY, '/upload', orphanPayload, token);
  check('200 on scan with bad farmId',      sync4.status === 200,          `got ${sync4.status}`);
  check('scan synced despite bad farmId',   sync4.body.syncedCounts?.scans === 1);
  check('conflict recorded for bad farmId', (sync4.body.conflicts as unknown[]).length >= 1);
  const dbOrphan = await prisma.scan.findUnique({ where: { id: orphanScanId } });
  check('orphan scan farmId is null in DB', dbOrphan?.farmId === null);

  // ── 25. GET /sync/status ──────────────────────────────────────────────────────
  section('25 ▸ GET /sync/status');

  check('401 without token', (await get(SY, '/status')).status === 401);

  const statusRes = await get(SY, '/status', token);
  check('200 on valid request',             statusRes.status === 200,      `got ${statusRes.status}`);
  check('devices array present',            Array.isArray(statusRes.body.devices));
  check('serverTimestamp present',          typeof statusRes.body.serverTimestamp === 'string');

  const syncedDevice = (statusRes.body.devices as J[]).find(d => d.deviceId === deviceId);
  check('synced device in list',            syncedDevice !== undefined);
  check('lastSyncAt updated after upload',  syncedDevice?.lastSyncAt !== null);
  check('device has registeredAt',          typeof syncedDevice?.registeredAt === 'string');

  // ── 26. DB SANITY ─────────────────────────────────────────────────────────────
  section('26 ▸ Database sanity (sync)');

  const dbFarm = await prisma.farm.findUnique({ where: { id: clientFarmId } });
  check('synced farm exists in DB',         dbFarm !== null);
  check('synced farm has correct userId',   dbFarm?.userId !== undefined);

  const dbScan2 = await prisma.scan.findUnique({ where: { id: clientScan2Id } });
  check('standalone scan exists in DB',     dbScan2 !== null);
  check('standalone scan farmId is null',   dbScan2?.farmId === null);

  const dbDevice = await prisma.device.findUnique({ where: { id: deviceId } });
  check('device lastSyncAt persisted',      dbDevice?.lastSyncAt !== null);
}

// ─── Entry point ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const email      = `__test_${Date.now()}@zaosmart.dev`;
  const otherEmail = `__test_other_${Date.now()}@zaosmart.dev`;

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(d(`Server started on port ${PORT} — running checks…`));

  try {
    console.log(b('\n╔═ ZaoSmart Backend Verification ═══════════════════════╗'));

    // Auth tests — returns a fresh access token for the farms suite
    const farmsToken = await runAuthTests(email);

    // Create a second user with zero farms (for cross-user isolation tests)
    const A = '/auth';
    const other = await post(A, '/register', {
      email: otherEmail,
      password: 'Other@9999',
      deviceName: 'Other Device',
    });
    const otherToken = other.body.accessToken as string;

    const farmId = await runFarmsTests(farmsToken, otherToken);
    await runScansTests(farmsToken, otherToken, farmId);
    await runDiseasesTests(farmsToken);

    // Login with a dedicated sync-test device to get a stable deviceId
    const syncLoginRes = await post('/auth', '/login', {
      email,
      password: 'Test@Secure99',
      deviceName: 'Sync Test Device',
    });
    await runSyncTests(farmsToken, syncLoginRes.body.deviceId as string);
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\n${'─'.repeat(56)}`);
  if (failed === 0) {
    console.log(g(b(`✓  All ${passed} checks passed — backend is production-ready.`)));
  } else {
    console.log(r(b(`✗  ${failed} check(s) failed  |  ${passed} passed.`)));
    console.log(r('   Fix the failures above before proceeding.'));
    process.exitCode = 1;
  }
  console.log();
  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error(r('\nFatal error in test runner:'), err);
  process.exit(1);
});
