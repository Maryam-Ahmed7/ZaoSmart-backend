import { Request, Response, NextFunction } from 'express';
import * as subscriptionService from '../services/subscription.service';
import { SubscriptionError } from '../services/subscription.service';
import { AuthRequest } from '../middleware/auth';

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof SubscriptionError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err);
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  try {
    const sub = await subscriptionService.getSubscription(userId);
    console.log('[Subscription] RESTORE_OK', { userId, plan: sub.plan });
    res.json(sub);
  } catch (err) {
    next(err);
  }
}

export async function trial(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  try {
    const sub = await subscriptionService.startTrial(userId);
    res.status(201).json(sub);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  try {
    const sub = await subscriptionService.activateSubscription(userId);
    res.json(sub);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  try {
    const sub = await subscriptionService.cancelSubscription(userId);
    res.json(sub);
  } catch (err) {
    handleError(err, res, next);
  }
}
