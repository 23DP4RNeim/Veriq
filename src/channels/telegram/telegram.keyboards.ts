import { InlineKeyboard, Keyboard } from 'grammy';
import type { CompanyMatchView } from '../../modules/companies/company.service.js';

export function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text('🔎 Check company').text('🏢 Company lookup').row()
    .text('📋 My history').text('⚙ Settings').row()
    .text('ℹ Help')
    .resized();
}

export function candidateKeyboard(matches: CompanyMatchView[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  matches.slice(0, 6).forEach((match, index) => {
    keyboard.text(`${index + 1}. ${match.name}`, `select|${match.id}`).row();
  });
  return keyboard;
}

export function reportKeyboard(companyId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Full report', `full|${companyId}`)
    .text('Verify again', `again|${companyId}`);
}

export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Concise reports', 'settings|concise')
    .text('Full reports', 'settings|full');
}
