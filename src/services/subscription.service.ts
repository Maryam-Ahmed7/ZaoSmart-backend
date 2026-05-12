import { prisma } from '../prisma';

export class SubscriptionError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

const FREE_PLAN_DAYS = 0;
const PREMIUM_PLAN_DAYS = 30;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Virtual response for users who have never activated a subscription
function freePlan(userId: string) {
  return {
    id:         null,
    userId,
    plan:       'free',
    status:     'active',
    startDate:  null,
    expiryDate: null,
    isActive:   true,
    createdAt:  null,
    updatedAt:  null,
  };
}

export async function getSubscription(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return sub ?? freePlan(userId);
}

export async function activateSubscription(userId: string) {
  const now        = new Date();
  const expiryDate = addDays(now, PREMIUM_PLAN_DAYS);

  return prisma.subscription.upsert({
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
}

export async function cancelSubscription(userId: string) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });

  if (!sub || sub.plan === 'free' || sub.status === 'cancelled') {
    throw new SubscriptionError(400, 'No active premium subscription to cancel');
  }

  return prisma.subscription.update({
    where: { userId },
    data:  { status: 'cancelled', isActive: false },
  });
}
