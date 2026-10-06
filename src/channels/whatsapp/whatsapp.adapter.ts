import type { ChannelAdapter } from '../channel.interface.js';

export class WhatsAppChannelAdapter implements ChannelAdapter {
  async sendMessage(): Promise<void> {
    throw new Error('WhatsApp support is not enabled. Connect an official WhatsApp Business API provider first.');
  }

  async sendButtons(): Promise<void> {
    throw new Error('WhatsApp support is not enabled. Connect an official WhatsApp Business API provider first.');
  }

  async handleIncomingMessage(): Promise<void> {
    throw new Error('WhatsApp support is not enabled.');
  }

  async handleCommand(): Promise<void> {
    throw new Error('WhatsApp support is not enabled.');
  }
}
