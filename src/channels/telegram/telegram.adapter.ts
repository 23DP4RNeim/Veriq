import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../../app/config.js';
import type { RuntimeServices } from '../../app/container.js';
import { isUniqueConstraintError, AppError } from '../../shared/app-error.js';
import { formatHistory, formatVerification } from './telegram.formatter.js';
import { candidateKeyboard, mainMenuKeyboard, reportKeyboard, settingsKeyboard } from './telegram.keyboards.js';
import { parseTelegramCommand } from './telegram.parsers.js';
import type { ChannelAdapter, ChannelButton, ChannelIncomingMessage } from '../channel.interface.js';

export class TelegramAdapter implements ChannelAdapter {
  readonly bot: Bot;
  private readonly awaitingQuery = new Set<string>();

  constructor(
    token: string,
    private readonly config: AppConfig,
    private readonly prisma: PrismaClient,
    private readonly services: RuntimeServices,
  ) {
    this.bot = new Bot(token);
    this.installDeduplication();
    this.installHandlers();
    this.bot.catch((error) => {
      console.error(JSON.stringify({ event: 'telegram_update_error', errorName: error.error instanceof Error ? error.error.name : 'unknown' }));
    });
  }

  async handleWebhook(update: unknown): Promise<'processed' | 'duplicate'> {
    if (typeof update !== 'object' || update === null || !('update_id' in update) || typeof update.update_id !== 'number') {
      throw new AppError('TELEGRAM_ERROR', 'Invalid Telegram update payload.');
    }
    await this.bot.handleUpdate(update as Parameters<typeof this.bot.handleUpdate>[0]);
    return 'processed';
  }

  async sendMessage(recipientId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(Number(recipientId), text);
  }

  async sendButtons(recipientId: string, text: string, buttons: ChannelButton[]): Promise<void> {
    const keyboard = new InlineKeyboard();
    for (const button of buttons) keyboard.text(button.text, button.callbackData).row();
    await this.bot.api.sendMessage(Number(recipientId), text, { reply_markup: keyboard });
  }

  async handleIncomingMessage(message: ChannelIncomingMessage): Promise<void> {
    await this.handleWebhook(message.raw);
  }

  async handleCommand(_command: string, message: ChannelIncomingMessage): Promise<void> {
    await this.handleWebhook(message.raw);
  }

  async startPolling(): Promise<void> {
    await this.bot.start({ onStart: () => console.info(JSON.stringify({ event: 'telegram_polling_started' })) });
  }

  async setWebhook(): Promise<void> {
    if (!this.config.TELEGRAM_WEBHOOK_URL || !this.config.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error('TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET are required for webhook mode.');
    }
    await this.bot.api.setWebhook(this.config.TELEGRAM_WEBHOOK_URL, { secret_token: this.config.TELEGRAM_WEBHOOK_SECRET });
  }

  private installDeduplication(): void {
    this.bot.use(async (context, next) => {
      const updateId = context.update.update_id;
      let acquired = false;
      try {
        await this.prisma.telegramUpdate.create({ data: { updateId } });
        acquired = true;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await this.prisma.telegramUpdate.findUnique({ where: { updateId }, select: { processedAt: true, receivedAt: true } });
        if (existing?.processedAt) return;
      if (!existing) throw error;
        if (existing.receivedAt.getTime() > Date.now() - 120_000) return;
        await this.prisma.telegramUpdate.update({ where: { updateId }, data: { receivedAt: new Date() } });
        acquired = true;
      }
      try {
        await next();
        await this.prisma.telegramUpdate.update({ where: { updateId }, data: { processedAt: new Date() } });
      } catch (error) {
        if (acquired) await this.prisma.telegramUpdate.delete({ where: { updateId } }).catch(() => undefined);
        throw error;
      }
    });
  }

  private installHandlers(): void {
    this.bot.command('start', async (context) => {
      const actor = await this.actor(context);
      if (actor) this.awaitingQuery.delete(actor.platformUserId);
      await context.reply('Welcome to Veriq.\n\nAssess a business using available registration and risk indicators. Results are decision support, not a guarantee, credit rating, or cybersecurity scan.', {
        reply_markup: mainMenuKeyboard(),
      });
    });

    this.bot.command('help', async (context) => {
      await context.reply('Send a Latvian registration number or company name to assess a business.\n\nExamples:\n/assess 40103999999\n/check SIA Baltic Example\n\nUse /history to view recent checks and /settings to change report detail.');
    });

    this.bot.command('check', async (context) => {
      await this.handleCheckCommand(context);
    });
    this.bot.command('company', async (context) => this.handleCheckCommand(context));
    this.bot.command('assess', async (context) => this.handleCheckCommand(context));

    this.bot.command('history', async (context) => {
      const actor = await this.actor(context);
      if (!actor) return;
      const history = await this.services.history.forUser(actor.userId);
      await context.reply(formatHistory(history), { reply_markup: mainMenuKeyboard() });
    });

    this.bot.command('status', async (context) => {
      const database = await this.services.companies.health();
      await context.reply([
        'VERIQ STATUS',
        `Service: ${database === 'ok' ? 'Operational' : 'Degraded'}`,
        `Database: ${database}`,
        `Company provider: ${this.services.companies.providerName}`,
        `Telegram: ${this.config.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'}`,
      ].join('\n'));
    });

    this.bot.command('settings', async (context) => {
      const actor = await this.actor(context);
      if (!actor) return;
      const style = await this.services.users.getReportStyle('telegram', actor.platformUserId);
      await context.reply(`Report detail: ${style}. Choose a default:`, { reply_markup: settingsKeyboard() });
    });

    this.bot.on('message:text', async (context) => {
      const text = context.message.text.trim();
      if (text.startsWith('/')) return;
      const actor = await this.actor(context);
      if (!actor) return;
      if (text === '🔎 Check company' || text === '🏢 Company lookup') {
        this.awaitingQuery.add(actor.platformUserId);
        await context.reply('Enter company registration number or company name.\n\nExamples:\n40103999999\nSIA Baltic Example');
        return;
      }
      if (text === '📋 My history') {
        await context.reply(formatHistory(await this.services.history.forUser(actor.userId)));
        return;
      }
      if (text === '⚙ Settings') {
        const style = await this.services.users.getReportStyle('telegram', actor.platformUserId);
        await context.reply(`Report detail: ${style}. Choose a default:`, { reply_markup: settingsKeyboard() });
        return;
      }
      if (text === 'ℹ Help') {
        await context.reply('Use /check followed by a registration number or company name. You can also send the query directly.');
        return;
      }
      this.awaitingQuery.delete(actor.platformUserId);
      await this.lookupAndReply(context, text, actor.userId, actor.platformUserId);
    });

    this.bot.callbackQuery(/^select\|([0-9a-f-]{36})$/i, async (context) => {
      const actor = await this.actor(context);
      if (!actor) return;
      const companyId = context.match[1];
      if (!companyId) return;
      await context.answerCallbackQuery();
      const outcome = await this.services.companies.verifyByCompanyId(companyId, { platform: 'telegram', userId: actor.userId });
      if (outcome.company && outcome.verification) {
        const style = await this.services.users.getReportStyle('telegram', actor.platformUserId);
        await context.reply(formatVerification(outcome.company, outcome.verification, style === 'full'), { reply_markup: reportKeyboard(companyId) });
      } else {
        await context.reply(this.outcomeMessage(outcome));
      }
    });

    this.bot.callbackQuery(/^full\|([0-9a-f-]{36})$/i, async (context) => {
      const actor = await this.actor(context);
      if (!actor) return;
      const companyId = context.match[1];
      if (!companyId) return;
      await context.answerCallbackQuery();
      const company = await this.services.companies.getCompanyById(companyId);
      if (!company) return void context.reply('Company was not found.');
      const verification = this.services.companies.verifyByCompanyId(companyId, { platform: 'telegram', userId: actor.userId });
      const outcome = await verification;
      if (outcome.company && outcome.verification) {
        await context.reply(formatVerification(company, outcome.verification, true));
      } else {
        await context.reply(this.outcomeMessage(outcome));
      }
    });

    this.bot.callbackQuery(/^again\|([0-9a-f-]{36})$/i, async (context) => {
      const actor = await this.actor(context);
      if (!actor) return;
      const companyId = context.match[1];
      if (!companyId) return;
      await context.answerCallbackQuery();
      const outcome = await this.services.companies.verifyByCompanyId(companyId, { platform: 'telegram', userId: actor.userId });
      if (outcome.company && outcome.verification) {
        await context.reply(formatVerification(outcome.company, outcome.verification), { reply_markup: reportKeyboard(companyId) });
      } else {
        await context.reply(this.outcomeMessage(outcome));
      }
    });

    this.bot.callbackQuery(/^settings\|(concise|full)$/, async (context) => {
      const actor = await this.actor(context);
      if (!actor) return;
      const style = context.match[1];
      if (style !== 'concise' && style !== 'full') return;
      await this.services.users.setReportStyle('telegram', actor.platformUserId, style);
      await context.answerCallbackQuery('Preference saved.');
      await context.editMessageText(`Default report detail set to ${style}.`);
    });
  }

  private async handleCheckCommand(context: Context): Promise<void> {
    const actor = await this.actor(context);
    if (!actor) return;
    const parsed = parseTelegramCommand(context.message && 'text' in context.message ? context.message.text : '');
    if (!parsed?.arguments) {
      this.awaitingQuery.add(actor.platformUserId);
      await context.reply('Enter company registration number or company name.\n\nExamples:\n40103999999\nSIA Baltic Example');
      return;
    }
    await this.lookupAndReply(context, parsed.arguments, actor.userId, actor.platformUserId);
  }

  private async lookupAndReply(context: Context, query: string, userId: string, platformUserId: string): Promise<void> {
    try {
      await this.services.rateLimit.consume(`telegram:${platformUserId}`);
      const outcome = await this.services.companies.verify(query, { platform: 'telegram', userId });
      if (outcome.status === 'MULTIPLE_MATCHES') {
        await context.reply('Multiple companies found. Choose one:', { reply_markup: candidateKeyboard(outcome.matches) });
        return;
      }
      if (!outcome.company || !outcome.verification) {
        await context.reply(this.outcomeMessage(outcome));
        return;
      }
      const style = await this.services.users.getReportStyle('telegram', platformUserId);
      await context.reply(formatVerification(outcome.company, outcome.verification, style === 'full'), {
        reply_markup: reportKeyboard(outcome.company.id),
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'RATE_LIMITED') {
        await context.reply(error.message);
        return;
      }
      throw error;
    }
  }

  private async actor(context: Context): Promise<{ userId: string; platformUserId: string } | null> {
    const telegramUserId = context.from?.id;
    if (telegramUserId === undefined) return null;
    const platformUserId = String(telegramUserId);
    const userId = await this.services.users.ensureBotUser('telegram', platformUserId);
    return { userId, platformUserId };
  }

  private outcomeMessage(outcome: { status: string }): string {
    if (outcome.status === 'NOT_FOUND') return 'No company was found in the available data.';
    if (outcome.status === 'DATA_UNAVAILABLE') return 'Company verification could not be completed because the data source is temporarily unavailable. Please try again later.';
    return 'The company lookup could not be completed. Please try again.';
  }
}
