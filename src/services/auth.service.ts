import crypto from 'crypto';
import { prisma } from '../prisma';
import { signAccessToken } from '../utils/jwt';

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function refreshExpiresAt(): Date {
  const days = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS ?? '7', 10);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function toUserDto(user: { id: string; phone: string; name: string; countryCode: string; language: string; createdAt: Date }) {
  return {
    id:          user.id,
    phone:       user.phone,
    name:        user.name,
    countryCode: user.countryCode,
    language:    user.language,
    createdAt:   user.createdAt,
  };
}

async function issueSession(userId: string, phone: string, deviceClientId: string) {
  // Find or create the device record keyed by the client's stable deviceId UUID
  let device = await prisma.device.findFirst({
    where: { name: deviceClientId, userId },
  });
  if (!device) {
    device = await prisma.device.create({
      data: { name: deviceClientId, userId },
    });
  }

  const token = await prisma.refreshToken.create({
    data: {
      token:     generateRefreshToken(),
      expiresAt: refreshExpiresAt(),
      userId,
      deviceId:  device.id,
    },
  });

  return {
    accessToken:  signAccessToken({ userId, phone }),
    refreshToken: token.token,
    deviceId:     device.id,
  };
}

// ─── Register (idempotent) ────────────────────────────────────────────────────
// If the phone number already exists this behaves as a login + profile update.
// This keeps the frontend's "try register → fallback login" pattern working even
// when the server already has the account.

export async function register(data: {
  phone:       string;
  name:        string;
  countryCode: string;
  language:    string;
  deviceId:    string;
}) {
  let user = await prisma.user.findUnique({ where: { phone: data.phone } });

  if (user) {
    console.log('[Auth] REGISTER existing user — updating profile', { userId: user.id, phone: data.phone });
    user = await prisma.user.update({
      where: { id: user.id },
      data:  {
        name:        data.name,
        countryCode: data.countryCode,
        language:    data.language,
      },
    });
  } else {
    console.log('[Auth] REGISTER new user — creating', { phone: data.phone, name: data.name });
    user = await prisma.user.create({
      data: {
        phone:       data.phone,
        name:        data.name,
        countryCode: data.countryCode,
        language:    data.language,
      },
    });
    console.log('[Auth] USER_CREATED', { userId: user.id });
  }

  const session = await issueSession(user.id, user.phone, data.deviceId);
  console.log('[Auth] SESSION_ISSUED', { userId: user.id, deviceId: session.deviceId });
  return { user: toUserDto(user), ...session };
}

// ─── Login ────────────────────────────────────────────────────────────────────
// Requires the phone to already exist. Used as fallback when register returns a
// conflict and the client wants to sign in to an existing account without
// updating the profile.

export async function login(data: { phone: string; deviceId: string }) {
  const user = await prisma.user.findUnique({ where: { phone: data.phone } });
  if (!user) throw new AuthError(404, 'No account found for this phone number');

  const session = await issueSession(user.id, user.phone, data.deviceId);
  return { user: toUserDto(user), ...session };
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refresh(data: { refreshToken: string }) {
  const stored = await prisma.refreshToken.findUnique({
    where:   { token: data.refreshToken },
    include: { user: true },
  });

  if (!stored) throw new AuthError(401, 'Invalid refresh token');
  if (stored.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    throw new AuthError(401, 'Refresh token expired');
  }

  const [newToken] = await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        token:     generateRefreshToken(),
        expiresAt: refreshExpiresAt(),
        userId:    stored.userId,
        deviceId:  stored.deviceId,
      },
    }),
    prisma.refreshToken.delete({ where: { id: stored.id } }),
  ]);

  return {
    accessToken:  signAccessToken({ userId: stored.user.id, phone: stored.user.phone }),
    refreshToken: newToken.token,
  };
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(data: { refreshToken: string }) {
  await prisma.refreshToken.deleteMany({ where: { token: data.refreshToken } });
}

// ─── Me ───────────────────────────────────────────────────────────────────────

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, phone: true, name: true, countryCode: true, language: true, createdAt: true, updatedAt: true },
  });
  if (!user) throw new AuthError(404, 'User not found');
  return user;
}

// ─── Restore ──────────────────────────────────────────────────────────────────
// Single round-trip to restore a full session on a new device:
// returns user profile + subscription state together.

export async function restore(userId: string) {
  const user = await prisma.user.findUnique({
    where:   { id: userId },
    include: { subscription: true },
  });
  if (!user) throw new AuthError(404, 'User not found');

  const sub = user.subscription;
  return {
    user: toUserDto(user),
    subscription: {
      plan:       sub?.plan       ?? 'free',
      status:     sub?.status     ?? 'active',
      isActive:   sub?.isActive   ?? true,
      startDate:  sub?.startDate  ?? null,
      expiryDate: sub?.expiryDate ?? null,
    },
  };
}
