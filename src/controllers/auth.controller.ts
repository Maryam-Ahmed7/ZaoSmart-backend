import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import { AuthError } from '../services/auth.service';
import { AuthRequest } from '../middleware/auth';

function handleAuthError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof AuthError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  // Prisma unique constraint violation
  if ((err as any)?.code === 'P2002') {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }
  next(err);
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password, deviceName } = req.body ?? {};
  if (!email || !password || !deviceName) {
    res.status(400).json({ error: 'email, password, and deviceName are required' });
    return;
  }
  try {
    const result = await authService.register({ email, password, deviceName });
    res.status(201).json(result);
  } catch (err) {
    handleAuthError(err, res, next);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { email, password, deviceName } = req.body ?? {};
  if (!email || !password || !deviceName) {
    res.status(400).json({ error: 'email, password, and deviceName are required' });
    return;
  }
  try {
    const result = await authService.login({ email, password, deviceName });
    res.json(result);
  } catch (err) {
    handleAuthError(err, res, next);
  }
}

export async function refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }
  try {
    const result = await authService.refresh({ refreshToken });
    res.json(result);
  } catch (err) {
    handleAuthError(err, res, next);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }
  try {
    await authService.logout({ refreshToken });
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getMe((req as AuthRequest).userId);
    res.json(user);
  } catch (err) {
    handleAuthError(err, res, next);
  }
}
