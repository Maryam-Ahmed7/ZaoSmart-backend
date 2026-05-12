import { prisma } from '../prisma';

export class ReminderError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ReminderError';
  }
}

type CreateData = {
  title: string;
  type: string;
  date: string;
  farmId?: string | null;
  description?: string | null;
  isCompleted?: boolean;
};

type UpdateData = Partial<CreateData>;

type ListFilters = {
  farmId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function createReminder(userId: string, data: CreateData) {
  if (data.farmId) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) throw new ReminderError(404, 'Farm not found');
  }

  return prisma.reminder.create({
    data: {
      userId,
      farmId:      data.farmId ?? null,
      title:       data.title,
      description: data.description ?? null,
      type:        data.type,
      date:        new Date(data.date),
      isCompleted: data.isCompleted ?? false,
    },
  });
}

export async function listReminders(userId: string, filters: ListFilters) {
  return prisma.reminder.findMany({
    where: {
      userId,
      ...(filters.farmId ? { farmId: filters.farmId } : {}),
      ...(filters.type   ? { type: filters.type }     : {}),
      ...(filters.dateFrom || filters.dateTo ? {
        date: {
          ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
          ...(filters.dateTo   ? { lte: new Date(filters.dateTo)   } : {}),
        },
      } : {}),
    },
    orderBy: { date: 'asc' },
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

  if (data.farmId !== undefined && data.farmId !== null) {
    const farm = await prisma.farm.findFirst({ where: { id: data.farmId, userId } });
    if (!farm) throw new ReminderError(404, 'Farm not found');
  }

  return prisma.reminder.update({
    where: { id: reminderId },
    data: {
      ...(data.title       !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.type        !== undefined && { type: data.type }),
      ...(data.date        !== undefined && { date: new Date(data.date) }),
      ...(data.farmId      !== undefined && { farmId: data.farmId }),
      ...(data.isCompleted !== undefined && { isCompleted: data.isCompleted }),
    },
  });
}

export async function deleteReminder(userId: string, reminderId: string) {
  const reminder = await prisma.reminder.findFirst({ where: { id: reminderId, userId } });
  if (!reminder) throw new ReminderError(404, 'Reminder not found');
  await prisma.reminder.delete({ where: { id: reminderId } });
}
