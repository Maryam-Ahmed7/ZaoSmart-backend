import { prisma } from '../prisma';

export class ReminderError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ReminderError';
  }
}

type CreateData = {
  id?:          string;   // client-provided UUID — preserved for cross-device consistency
  title:        string;
  scheduledAt:  string;
  cropId?:      string | null;
  farmId?:      string | null;
  recurrence?:  string | null;
  isCompleted?: boolean;
};

type UpdateData = Partial<Omit<CreateData, 'id'>>;

type ListFilters = {
  farmId?:   string;
  cropId?:   string;
  dateFrom?: string;
  dateTo?:   string;
};

export async function createReminder(userId: string, data: CreateData) {
  console.log('[RemindersService] CREATE_REMINDER', { userId, id: data.id, title: data.title });

  if (data.farmId) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) throw new ReminderError(404, 'Farm not found');
  }

  let reminder;
  if (data.id) {
    reminder = await prisma.reminder.upsert({
      where: { id: data.id },
      update: {},
      create: {
        id:          data.id,
        userId,
        title:       data.title,
        scheduledAt: new Date(data.scheduledAt),
        cropId:      data.cropId      ?? null,
        farmId:      data.farmId      ?? null,
        recurrence:  data.recurrence  ?? null,
        isCompleted: data.isCompleted ?? false,
      },
    });
  } else {
    reminder = await prisma.reminder.create({
      data: {
        userId,
        title:       data.title,
        scheduledAt: new Date(data.scheduledAt),
        cropId:      data.cropId      ?? null,
        farmId:      data.farmId      ?? null,
        recurrence:  data.recurrence  ?? null,
        isCompleted: data.isCompleted ?? false,
      },
    });
  }

  console.log('[RemindersService] REMINDER_CREATED', { id: reminder.id, userId });
  return reminder;
}

export async function listReminders(userId: string, filters: ListFilters) {
  return prisma.reminder.findMany({
    where: {
      userId,
      ...(filters.farmId ? { farmId: filters.farmId } : {}),
      ...(filters.cropId ? { cropId: filters.cropId } : {}),
      ...(filters.dateFrom || filters.dateTo ? {
        scheduledAt: {
          ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
          ...(filters.dateTo   ? { lte: new Date(filters.dateTo)   } : {}),
        },
      } : {}),
    },
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function getReminder(userId: string, reminderId: string) {
  const reminder = await prisma.reminder.findFirst({ where: { id: reminderId, userId } });
  if (!reminder) throw new ReminderError(404, 'Reminder not found');
  return reminder;
}

export async function updateReminder(userId: string, reminderId: string, data: UpdateData) {
  const reminder = await prisma.reminder.findFirst({ where: { id: reminderId, userId } });
  if (!reminder) throw new ReminderError(404, 'Reminder not found');

  if (data.farmId) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) throw new ReminderError(404, 'Farm not found');
  }

  return prisma.reminder.update({
    where: { id: reminderId },
    data: {
      ...(data.title       !== undefined && { title:       data.title }),
      ...(data.scheduledAt !== undefined && { scheduledAt: new Date(data.scheduledAt) }),
      ...(data.cropId      !== undefined && { cropId:      data.cropId }),
      ...(data.farmId      !== undefined && { farmId:      data.farmId }),
      ...(data.recurrence  !== undefined && { recurrence:  data.recurrence }),
      ...(data.isCompleted !== undefined && { isCompleted: data.isCompleted }),
    },
  });
}

export async function deleteReminder(userId: string, reminderId: string) {
  const reminder = await prisma.reminder.findFirst({ where: { id: reminderId, userId } });
  if (!reminder) throw new ReminderError(404, 'Reminder not found');
  await prisma.reminder.delete({ where: { id: reminderId } });
}
