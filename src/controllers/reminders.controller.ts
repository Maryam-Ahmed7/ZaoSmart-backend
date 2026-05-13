import { Request, Response, NextFunction } from 'express';
import * as remindersService from '../services/reminders.service';
import { ReminderError } from '../services/reminders.service';
import { AuthRequest } from '../middleware/auth';

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ReminderError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err);
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && !isNaN(new Date(value).getTime());
}

// Shape returned to frontend — matches ReminderDto in reminders.api.ts
function toDto(r: {
  id: string; title: string; cropId: string | null; farmId: string | null;
  scheduledAt: Date; isCompleted: boolean; recurrence: string | null; createdAt: Date;
}) {
  return {
    id:          r.id,
    title:       r.title,
    cropId:      r.cropId      ?? undefined,
    farmId:      r.farmId      ?? undefined,
    scheduledAt: r.scheduledAt.toISOString(),
    isCompleted: r.isCompleted,
    recurrence:  (r.recurrence ?? undefined) as 'daily' | 'weekly' | 'none' | undefined,
    createdAt:   r.createdAt.toISOString(),
  };
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const { id, title, scheduledAt, cropId, farmId, recurrence, isCompleted } = req.body ?? {};

  if (!title || !scheduledAt) {
    res.status(400).json({ error: 'title and scheduledAt are required' });
    return;
  }
  if (!isValidDate(scheduledAt)) {
    res.status(400).json({ error: 'scheduledAt must be a valid ISO date string' });
    return;
  }

  try {
    const reminder = await remindersService.createReminder(userId, {
      id, title, scheduledAt, cropId, farmId, recurrence, isCompleted,
    });
    res.status(201).json(toDto(reminder));
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId   = (req as AuthRequest).userId;
  const farmId   = typeof req.query.farmId   === 'string' ? req.query.farmId   : undefined;
  const cropId   = typeof req.query.cropId   === 'string' ? req.query.cropId   : undefined;
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo   = typeof req.query.dateTo   === 'string' ? req.query.dateTo   : undefined;

  try {
    const reminders = await remindersService.listReminders(userId, { farmId, cropId, dateFrom, dateTo });
    res.json(reminders.map(toDto));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId     = (req as AuthRequest).userId;
  const reminderId = req.params.id as string;
  try {
    const reminder = await remindersService.getReminder(userId, reminderId);
    res.json(toDto(reminder));
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId     = (req as AuthRequest).userId;
  const reminderId = req.params.id as string;
  const { title, scheduledAt, cropId, farmId, recurrence, isCompleted } = req.body ?? {};

  if (scheduledAt !== undefined && !isValidDate(scheduledAt)) {
    res.status(400).json({ error: 'scheduledAt must be a valid ISO date string' });
    return;
  }

  try {
    const reminder = await remindersService.updateReminder(userId, reminderId, {
      title, scheduledAt, cropId, farmId, recurrence, isCompleted,
    });
    res.json(toDto(reminder));
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId     = (req as AuthRequest).userId;
  const reminderId = req.params.id as string;
  try {
    await remindersService.deleteReminder(userId, reminderId);
    res.status(204).send();
  } catch (err) {
    handleError(err, res, next);
  }
}
