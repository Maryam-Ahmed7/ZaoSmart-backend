import { Request, Response, NextFunction } from 'express';
import * as remindersService from '../services/reminders.service';
import { ReminderError } from '../services/reminders.service';
import { AuthRequest } from '../middleware/auth';

const VALID_TYPES = ['watering', 'spraying', 'fertilizing', 'inspection', 'other'];

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

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as AuthRequest).userId;
  const { title, type, date, farmId, description, isCompleted } = req.body ?? {};

  if (!title || !type || !date) {
    res.status(400).json({ error: 'title, type, and date are required' });
    return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  if (!isValidDate(date)) {
    res.status(400).json({ error: 'date must be a valid ISO date string' });
    return;
  }

  try {
    const reminder = await remindersService.createReminder(userId, {
      title, type, date, farmId, description, isCompleted,
    });
    res.status(201).json(reminder);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId   = (req as AuthRequest).userId;
  const farmId   = typeof req.query.farmId   === 'string' ? req.query.farmId   : undefined;
  const type     = typeof req.query.type     === 'string' ? req.query.type     : undefined;
  const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
  const dateTo   = typeof req.query.dateTo   === 'string' ? req.query.dateTo   : undefined;

  if (type && !VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  if (dateFrom && !isValidDate(dateFrom)) {
    res.status(400).json({ error: 'dateFrom must be a valid ISO date string' });
    return;
  }
  if (dateTo && !isValidDate(dateTo)) {
    res.status(400).json({ error: 'dateTo must be a valid ISO date string' });
    return;
  }

  try {
    const reminders = await remindersService.listReminders(userId, { farmId, type, dateFrom, dateTo });
    res.json(reminders);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId     = (req as AuthRequest).userId;
  const reminderId = req.params.id as string;

  try {
    const reminder = await remindersService.getReminder(userId, reminderId);
    res.json(reminder);
  } catch (err) {
    handleError(err, res, next);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId     = (req as AuthRequest).userId;
  const reminderId = req.params.id as string;
  const { title, type, date, farmId, description, isCompleted } = req.body ?? {};

  if (type !== undefined && !VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  if (date !== undefined && !isValidDate(date)) {
    res.status(400).json({ error: 'date must be a valid ISO date string' });
    return;
  }

  try {
    const reminder = await remindersService.updateReminder(userId, reminderId, {
      title, type, date, farmId, description, isCompleted,
    });
    res.json(reminder);
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
