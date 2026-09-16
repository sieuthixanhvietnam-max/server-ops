import { getMessageApi } from './messageBridge';

/** Copies plain text. Use '\t' between values on the same line and '\n'
 * between lines - that's the exact layout Google Sheets/Excel expect from
 * clipboard paste: tabs become column breaks, newlines become row breaks. */
export const copyText = (text: string, successMessage = 'Đã copy') => {
  const message = getMessageApi();
  navigator.clipboard
    .writeText(text)
    .then(() => message.success(successMessage))
    .catch(() => message.error('Không copy được - trình duyệt chặn clipboard'));
};
