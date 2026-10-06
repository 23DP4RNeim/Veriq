import type { Platform, PrismaClient } from '@prisma/client';
import { isUniqueConstraintError } from '../../shared/app-error.js';

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureBotUser(platform: Platform, platformUserId: string, username?: string): Promise<string> {
    const existing = await this.prisma.botUser.findUnique({
      where: { platform_platformUserId: { platform, platformUserId } },
      select: { userId: true },
    });
    if (existing) return existing.userId;

    const user = await this.prisma.user.create({ data: {} });
    try {
      const botUser = await this.prisma.botUser.upsert({
        where: { platform_platformUserId: { platform, platformUserId } },
        create: {
          userId: user.id, platform, platformUserId,
          telegramUserId: platform === 'telegram' ? platformUserId : null,
          username: username ? username.slice(0, 64) : null,
        },
        update: { username: username ? username.slice(0, 64) : null },
        select: { userId: true },
      });
      return botUser.userId;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const concurrent = await this.prisma.botUser.findUnique({
          where: { platform_platformUserId: { platform, platformUserId } },
          select: { userId: true },
        });
        if (concurrent) {
          await this.prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
          return concurrent.userId;
        }
      }
      throw error;
    }
  }

  async getReportStyle(platform: Platform, platformUserId: string): Promise<'concise' | 'full'> {
    const botUser = await this.prisma.botUser.findUnique({
      where: { platform_platformUserId: { platform, platformUserId } },
      select: { reportStyle: true },
    });
    return botUser?.reportStyle === 'full' ? 'full' : 'concise';
  }

  async setReportStyle(platform: Platform, platformUserId: string, reportStyle: 'concise' | 'full'): Promise<void> {
    await this.prisma.botUser.update({
      where: { platform_platformUserId: { platform, platformUserId } },
      data: { reportStyle },
    });
  }
}

export type HistoryItem = {
  id: string;
  query: string;
  resultStatus: string;
  createdAt: Date;
  company: { id: string; registrationNumber: string; name: string } | null;
};

export class HistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async forUser(userId: string, limit = 20): Promise<HistoryItem[]> {
    return this.prisma.lookupHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 20),
      select: {
        id: true, query: true, resultStatus: true, createdAt: true,
        company: { select: { id: true, registrationNumber: true, name: true } },
      },
    });
  }

  async forCompany(companyId: string, limit = 20): Promise<HistoryItem[]> {
    return this.prisma.lookupHistory.findMany({
      where: { companyId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 20),
      select: {
        id: true, query: true, resultStatus: true, createdAt: true,
        company: { select: { id: true, registrationNumber: true, name: true } },
      },
    });
  }
}
