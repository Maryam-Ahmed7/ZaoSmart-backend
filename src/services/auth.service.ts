import crypto from 'crypto';
import { prisma } from '../prisma';
import { hashPassword, verifyPassword } from '../utils/hash';
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
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

export async function register(data: { email: string; password: string; deviceName: string }) {
  const passwordHash = await hashPassword(data.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: data.email, passwordHash },
    });
    const device = await tx.device.create({
      data: { name: data.deviceName, userId: created.id },
    });
    await tx.refreshToken.create({
      data: {
        token: generateRefreshToken(),
        expiresAt: refreshExpiresAt(),
        userId: created.id,
        deviceId: device.id,
      },
    });
    return tx.user.findUniqueOrThrow({
      where: { id: created.id },
      include: { devices: { include: { refreshTokens: true } } },
    });
  });

  const device = user.devices[0];
  const refreshToken = device.refreshTokens[0];

  return {
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    accessToken: signAccessToken({ userId: user.id, email: user.email }),
    refreshToken: refreshToken.token,
    deviceId: device.id,
  };
}

export async function login(data: { email: string; password: string; deviceName: string }) {
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new AuthError(401, 'Invalid credentials');

  const valid = await verifyPassword(data.password, user.passwordHash);
  if (!valid) throw new AuthError(401, 'Invalid credentials');

  const device = await prisma.device.create({
    data: { name: data.deviceName, userId: user.id },
  });
  const refreshToken = await prisma.refreshToken.create({
    data: {
      token: generateRefreshToken(),
      expiresAt: refreshExpiresAt(),
      userId: user.id,
      deviceId: device.id,
    },
  });

  return {
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    accessToken: signAccessToken({ userId: user.id, email: user.email }),
    refreshToken: refreshToken.token,
    deviceId: device.id,
  };
}

export async function refresh(data: { refreshToken: string }) {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: data.refreshToken },
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
        token: generateRefreshToken(),
        expiresAt: refreshExpiresAt(),
        userId: stored.userId,
        deviceId: stored.deviceId,
      },
    }),
    prisma.refreshToken.delete({ where: { id: stored.id } }),
  ]);

  return {
    accessToken: signAccessToken({ userId: stored.user.id, email: stored.user.email }),
    refreshToken: newToken.token,
  };
}

export async function logout(data: { refreshToken: string }) {
  await prisma.refreshToken.deleteMany({ where: { token: data.refreshToken } });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, createdAt: true, updatedAt: true },
  });
  if (!user) throw new AuthError(404, 'User not found');
  return user;
}
