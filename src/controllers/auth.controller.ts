import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import { AuthError } from '../services/auth.service';
import { AuthRequest } from '../middleware/auth';

function handleAuthError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof AuthError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err);
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { phone, name, countryCode, language, deviceId } = req.body ?? {};
  if (!phone || !name || !deviceId) {
    res.status(400).json({ error: 'phone, name, and deviceId are required' });
    return;
  }
  try {
    const result = await authService.register({
      phone,
      name,
      countryCode: countryCode ?? '',
      language:    language    ?? 'en',
      deviceId,
    });
    res.status(201).json(result);
  } catch (err) {
    handleAuthError(err, res, next);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { phone, deviceId } = req.body ?? {};
  if (!phone || !deviceId) {
    res.status(400).json({ error: 'phone and deviceId are required' });
    return;
  }
  try {
    const result = await authService.login({ phone, deviceId });
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

// Returns user profile + subscription in a single call — used for cross-device
// session restoration after login.
export async function restore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.restore((req as AuthRequest).userId);
    res.json(result);
  } catch (err) {
    handleAuthError(err, res, next);
  }
}
