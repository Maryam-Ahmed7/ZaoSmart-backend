import { prisma } from '../prisma';

export class SubscriptionError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

const TRIAL_PLAN_DAYS   = 7;
const PREMIUM_PLAN_DAYS = 30;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function freePlan(userId: string) {
  return {
    id:         null as string | null,
    userId,
    plan:       'free',
    status:     'active',
    startDate:  null as Date | null,
    expiryDate: null as Date | null,
    isActive:   true,
    createdAt:  null as Date | null,
    updatedAt:  null as Date | null,
  };
}

export async function getSubscription(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  console.log('[Subscription] GET', { userId, plan: sub?.plan ?? 'free', isActive: sub?.isActive ?? true });
  return sub ?? freePlan(userId);
}

export async function startTrial(userId: string) {
  const now        = new Date();
  const expiryDate = addDays(now, TRIAL_PLAN_DAYS);
  console.log('[Subscription] START_TRIAL', { userId, expiryDate });

  const sub = await prisma.subscription.upsert({
    where:  { userId },
    update: {
      plan:       'trial',
      status:     'active',
      startDate:  now,
      expiryDate,
      isActive:   true,
    },
    create: {
      userId,
      plan:       'trial',
      status:     'active',
      startDate:  now,
      expiryDate,
      isActive:   true,
    },
  });

  console.log('[Subscription] DB_WRITE_OK', { userId, plan: sub.plan, expiryDate: sub.expiryDate });
  return sub;
}

export async function activateSubscription(userId: string) {
  const now        = new Date();
  const expiryDate = addDays(now, PREMIUM_PLAN_DAYS);
  console.log('[Subscription] ACTIVATE_PREMIUM', { userId, expiryDate });

  const sub = await prisma.subscription.upsert({
    where:  { userId },
    update: {
      plan:       'premium',
      status:     'active',
      startDate:  now,
      expiryDate,
      isActive:   true,
    },
    create: {
      userId,
      plan:       'premium',
      status:     'active',
      startDate:  now,
      expiryDate,
      isActive:   true,
    },
  });

  console.log('[Subscription] DB_WRITE_OK', { userId, plan: sub.plan, expiryDate: sub.expiryDate });
  return sub;
}

export async function cancelSubscription(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub || sub.plan === 'free' || sub.status === 'cancelled') {
    throw new SubscriptionError(400, 'No active subscription to cancel');
  }
  return prisma.subscription.update({
    where: { userId },
    data:  { status: 'cancelled', isActive: false },
  });
}
