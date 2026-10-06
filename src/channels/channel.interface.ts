export interface ChannelButton {
  text: string;
  callbackData: string;
}

export interface ChannelIncomingMessage {
  raw: unknown;
  text?: string;
  senderId?: string;
}

export interface ChannelAdapter {
  sendMessage(recipientId: string, text: string): Promise<void>;
  sendButtons(recipientId: string, text: string, buttons: ChannelButton[]): Promise<void>;
  handleIncomingMessage(message: ChannelIncomingMessage): Promise<void>;
  handleCommand(command: string, message: ChannelIncomingMessage): Promise<void>;
}
