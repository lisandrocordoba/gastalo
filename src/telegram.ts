import type { AccountWithBalance, Category, Env, Transaction } from './types';
import {
  createTransaction,
  deleteTransaction,
  getMonthSummary,
  getTransactionById,
  listAccountsWithBalances,
  listCategories,
  listTransactions,
  updateTransaction,
} from './db';
import { answerFinancialQuery, parseMessageWithGemini } from './gemini';
import { arrayBufferToBase64, currentMonthInTimezone, formatCurrency, todayInTimezone } from './utils';

export interface TelegramUser {
  id: number;
  first_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number };
  text?: string;
  caption?: string;
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
  photo?: TelegramPhotoSize[];
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface InlineButton {
  text: string;
  callback_data?: string;
  web_app?: { url: string };
}

async function tgCall<T = unknown>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw new Error(`Telegram API ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result as T;
}

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  inlineKeyboard?: InlineButton[][]
): Promise<void> {
  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
  });
}

async function sendChatAction(token: string, chatId: number, action = 'typing'): Promise<void> {
  await tgCall(token, 'sendChatAction', { chat_id: chatId, action }).catch(() => {});
}

async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  inlineKeyboard?: InlineButton[][]
): Promise<void> {
  await tgCall(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: inlineKeyboard ?? [] },
  });
}

async function answerCallbackQuery(token: string, callbackId: string, text?: string): Promise<void> {
  await tgCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    ...(text ? { text } : {}),
  });
}

async function downloadTelegramFile(
  token: string,
  fileId: string
): Promise<{ base64: string; filePath: string }> {
  const fileInfo = await tgCall<{ file_path: string }>(token, 'getFile', { file_id: fileId });
  const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to download Telegram file: ${res.status}`);
  }
  const buffer = await res.arrayBuffer();
  return {
    base64: arrayBufferToBase64(buffer),
    filePath: fileInfo.file_path,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mainTxKeyboard(txId: string): InlineButton[][] {
  return [
    [
      { text: '✅ OK', callback_data: `ok:${txId}` },
      { text: '✏️ Categoría', callback_data: `catm:${txId}` },
    ],
    [
      { text: '🔄 Cuenta', callback_data: `accm:${txId}` },
      { text: '🗑️ Borrar', callback_data: `del:${txId}` },
    ],
  ];
}

function formatTransactionMessage(
  tx: Transaction,
  accounts: AccountWithBalance[],
  categories: Category[],
  statusLine?: string
): string {
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const fromAcc = accMap.get(tx.account_id)?.name ?? tx.account_id;
  const toAcc = tx.to_account_id ? (accMap.get(tx.to_account_id)?.name ?? tx.to_account_id) : null;
  const cat = tx.category_id ? catMap.get(tx.category_id) : null;

  const header =
    tx.type === 'income'
      ? '💚 <b>Ingreso registrado</b>'
      : tx.type === 'transfer'
        ? '🔁 <b>Transferencia registrada</b>'
        : '🧾 <b>Gasto registrado</b>';

  const lines = [
    header,
    `• <b>Monto:</b> ${formatCurrency(tx.amount, tx.currency)}`,
    `• <b>Descripción:</b> ${escapeHtml(tx.description)}`,
  ];

  if (tx.type === 'transfer' && toAcc) {
    lines.push(`• <b>Ruta:</b> ${escapeHtml(fromAcc)} → ${escapeHtml(toAcc)}`);
  } else {
    lines.push(`• <b>Cuenta:</b> ${escapeHtml(fromAcc)}`);
    if (cat) {
      lines.push(`• <b>Categoría:</b> ${cat.icon} ${escapeHtml(cat.name)}`);
    }
  }

  lines.push(`• <b>Fecha:</b> ${tx.occurred_at}`);
  if (statusLine) {
    lines.push(`\n${statusLine}`);
  }
  return lines.join('\n');
}

function formatBalancesText(accounts: AccountWithBalance[]): string {
  const lines = ['🏦 <b>Saldos actuales</b>\n'];
  let liquidTotal = 0;
  let savingsTotal = 0;
  let debtTotal = 0;

  for (const acc of accounts) {
    const emoji =
      acc.type === 'credit_card'
        ? '💳'
        : acc.type === 'savings'
          ? '🛡️'
          : acc.type === 'cash'
            ? '💵'
            : '🟦';
    lines.push(`${emoji} <b>${escapeHtml(acc.name)}:</b> ${formatCurrency(acc.balance, acc.currency)}`);
    if (acc.type === 'wallet' || acc.type === 'cash') liquidTotal += acc.balance;
    else if (acc.type === 'savings') savingsTotal += acc.balance;
    else if (acc.type === 'credit_card') debtTotal += acc.balance;
  }

  lines.push('');
  lines.push(`💧 <b>Disponible (MP + Efectivo):</b> ${formatCurrency(liquidTotal)}`);
  lines.push(`🛡️ <b>Reservas:</b> ${formatCurrency(savingsTotal)}`);
  lines.push(`📊 <b>Patrimonio neto:</b> ${formatCurrency(liquidTotal + savingsTotal + debtTotal)}`);
  return lines.join('\n');
}

async function handleCommand(env: Env, chatId: number, command: string): Promise<void> {
  const tz = env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const cmd = command.split(/\s+/)[0].toLowerCase();

  if (cmd === '/start' || cmd === '/ayuda' || cmd === '/help') {
    const text = [
      '👋 <b>Hola! Soy tu Gasti personal.</b>',
      '',
      'Podés mandarme gastos, ingresos o transferencias como quieras:',
      '• <b>Texto:</b> <i>"Café 3500"</i>, <i>"Supermercado 45k con BBVA"</i>, <i>"Pasé 100k a reservas"</i>, <i>"Pagué la tarjeta 250000"</i>',
      '• <b>Audio:</b> Nota de voz contando el gasto',
      '• <b>Foto:</b> Foto de ticket o captura de pago',
      '• <b>Preguntas:</b> <i>"¿Cuánto gasté en comida este mes?"</i>',
      '',
      '<b>Comandos útiles:</b>',
      '/resumen — Resumen del mes actual',
      '/saldos — Saldos de MP, Reservas, BBVA y Efectivo',
      '/ultimos — Últimos 5 movimientos',
    ].join('\n');

    const keyboard: InlineButton[][] | undefined = env.DASHBOARD_URL
      ? [[{ text: '📊 Abrir Dashboard', web_app: { url: env.DASHBOARD_URL } }]]
      : undefined;

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, keyboard);
    return;
  }

  if (cmd === '/saldos') {
    const accounts = await listAccountsWithBalances(env.DB);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, formatBalancesText(accounts));
    return;
  }

  if (cmd === '/resumen' || cmd === '/mes') {
    const month = currentMonthInTimezone(tz);
    const summary = await getMonthSummary(env.DB, month);
    const lines = [
      `📅 <b>Resumen ${month}</b>\n`,
      `💚 <b>Ingresos:</b> ${formatCurrency(summary.income)}`,
      `💸 <b>Gastos:</b> ${formatCurrency(summary.expense)}`,
      `⚖️ <b>Balance del mes:</b> ${formatCurrency(summary.net)}`,
    ];

    if (summary.by_category.length > 0) {
      lines.push('\n<b>Top categorías:</b>');
      for (const c of summary.by_category.slice(0, 6)) {
        lines.push(`${c.icon} ${escapeHtml(c.name)}: ${formatCurrency(c.total)} (${c.percentage}%)`);
      }
    }

    lines.push('\n' + formatBalancesText(summary.accounts));
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
    return;
  }

  if (cmd === '/ultimos') {
    const [txs, accounts, categories] = await Promise.all([
      listTransactions(env.DB, { limit: 5 }),
      listAccountsWithBalances(env.DB),
      listCategories(env.DB),
    ]);
    if (txs.length === 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Todavía no hay movimientos cargados.');
      return;
    }
    const accMap = new Map(accounts.map((a) => [a.id, a.name]));
    const catMap = new Map(categories.map((c) => [c.id, `${c.icon} ${c.name}`]));

    const lines = ['🕒 <b>Últimos movimientos</b>\n'];
    for (const tx of txs) {
      const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '🔁';
      const label =
        tx.type === 'transfer'
          ? `${accMap.get(tx.account_id) ?? tx.account_id} → ${accMap.get(tx.to_account_id ?? '') ?? ''}`
          : `${catMap.get(tx.category_id ?? '') ?? 'Sin cat.'} · ${accMap.get(tx.account_id) ?? tx.account_id}`;
      lines.push(
        `${sign} <b>${formatCurrency(tx.amount, tx.currency)}</b> — ${escapeHtml(tx.description)}\n   <i>${tx.occurred_at} · ${escapeHtml(label)}</i>`
      );
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
  }
}

async function handleCallbackQuery(env: Env, cb: TelegramCallbackQuery): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const data = cb.data ?? '';
  const msg = cb.message;
  if (!msg) {
    await answerCallbackQuery(token, cb.id);
    return;
  }

  const [action, txId, param] = data.split(':');
  if (!txId) {
    await answerCallbackQuery(token, cb.id);
    return;
  }

  if (action === 'ok') {
    const [tx, accounts, categories] = await Promise.all([
      getTransactionById(env.DB, txId),
      listAccountsWithBalances(env.DB),
      listCategories(env.DB),
    ]);
    if (tx) {
      await editMessageText(
        token,
        msg.chat.id,
        msg.message_id,
        formatTransactionMessage(tx, accounts, categories, '✅ <i>Confirmado</i>')
      );
    }
    await answerCallbackQuery(token, cb.id, 'Confirmado');
    return;
  }

  if (action === 'del') {
    const deleted = await deleteTransaction(env.DB, txId);
    await editMessageText(
      token,
      msg.chat.id,
      msg.message_id,
      deleted ? '🗑️ <i>Movimiento eliminado.</i>' : '⚠️ <i>El movimiento ya no existe.</i>'
    );
    await answerCallbackQuery(token, cb.id, deleted ? 'Eliminado' : 'No encontrado');
    return;
  }

  if (action === 'catm') {
    const [tx, categories] = await Promise.all([
      getTransactionById(env.DB, txId),
      listCategories(env.DB),
    ]);
    if (!tx) {
      await answerCallbackQuery(token, cb.id, 'Movimiento no encontrado');
      return;
    }
    const filtered = categories.filter((c) =>
      tx.type === 'income' ? c.type === 'income' || c.type === 'both' : c.type === 'expense' || c.type === 'both'
    );
    const rows: InlineButton[][] = [];
    for (let i = 0; i < filtered.length; i += 2) {
      rows.push(
        filtered.slice(i, i + 2).map((c) => ({
          text: `${c.icon} ${c.name}`,
          callback_data: `cat:${txId}:${c.id}`,
        }))
      );
    }
    rows.push([{ text: '⬅️ Volver', callback_data: `back:${txId}` }]);

    await editMessageText(token, msg.chat.id, msg.message_id, '📂 <b>Elegí la nueva categoría:</b>', rows);
    await answerCallbackQuery(token, cb.id);
    return;
  }

  if (action === 'accm') {
    const accounts = await listAccountsWithBalances(env.DB);
    const rows: InlineButton[][] = accounts.map((a) => [
      { text: a.name, callback_data: `acc:${txId}:${a.id}` },
    ]);
    rows.push([{ text: '⬅️ Volver', callback_data: `back:${txId}` }]);
    await editMessageText(token, msg.chat.id, msg.message_id, '🏦 <b>Elegí la cuenta:</b>', rows);
    await answerCallbackQuery(token, cb.id);
    return;
  }

  if (action === 'cat' && param) {
    await updateTransaction(env.DB, txId, { category_id: param });
  } else if (action === 'acc' && param) {
    await updateTransaction(env.DB, txId, { account_id: param });
  }

  const [tx, accounts, categories] = await Promise.all([
    getTransactionById(env.DB, txId),
    listAccountsWithBalances(env.DB),
    listCategories(env.DB),
  ]);
  if (!tx) {
    await answerCallbackQuery(token, cb.id, 'Movimiento no encontrado');
    return;
  }
  await editMessageText(
    token,
    msg.chat.id,
    msg.message_id,
    formatTransactionMessage(tx, accounts, categories),
    mainTxKeyboard(tx.id)
  );
  await answerCallbackQuery(token, cb.id, action === 'back' ? undefined : 'Actualizado');
}

export async function handleTelegramUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  const allowedId = Number(env.ALLOWED_TELEGRAM_USER_ID);

  if (update.callback_query) {
    if (allowedId && update.callback_query.from.id !== allowedId) return;
    await handleCallbackQuery(env, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message || !message.from) return;
  if (allowedId && message.from.id !== allowedId) return;

  const chatId = message.chat.id;
  const text = message.text?.trim() ?? message.caption?.trim() ?? '';

  if (text.startsWith('/')) {
    await handleCommand(env, chatId, text);
    return;
  }

  try {
    await sendChatAction(env.TELEGRAM_BOT_TOKEN, chatId, 'typing');
    const tz = env.TIMEZONE || 'America/Argentina/Buenos_Aires';
    const today = todayInTimezone(tz);
    const [accounts, categories] = await Promise.all([
      listAccountsWithBalances(env.DB),
      listCategories(env.DB),
    ]);

    let media: { base64: string; mimeType: string; kind: 'audio' | 'image' } | undefined;
    let source = 'telegram_text';

    if (message.voice) {
      const downloaded = await downloadTelegramFile(env.TELEGRAM_BOT_TOKEN, message.voice.file_id);
      media = {
        base64: downloaded.base64,
        mimeType: message.voice.mime_type || 'audio/ogg',
        kind: 'audio',
      };
      source = 'telegram_voice';
    } else if (message.audio) {
      const downloaded = await downloadTelegramFile(env.TELEGRAM_BOT_TOKEN, message.audio.file_id);
      media = {
        base64: downloaded.base64,
        mimeType: message.audio.mime_type || 'audio/mpeg',
        kind: 'audio',
      };
      source = 'telegram_voice';
    } else if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      const downloaded = await downloadTelegramFile(env.TELEGRAM_BOT_TOKEN, largest.file_id);
      const ext = downloaded.filePath.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
      media = {
        base64: downloaded.base64,
        mimeType,
        kind: 'image',
      };
      source = 'telegram_photo';
    }

    if (!text && !media) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'Mandame un texto, un audio o una foto de un ticket para registrarlo.'
      );
      return;
    }

    const parsed = await parseMessageWithGemini(env, {
      text,
      media,
      accounts,
      categories,
      today,
    });

    if (parsed.intent === 'query') {
      const month = currentMonthInTimezone(tz);
      const [summary, recent] = await Promise.all([
        getMonthSummary(env.DB, month),
        listTransactions(env.DB, { month, limit: 30 }),
      ]);
      const answer = await answerFinancialQuery(env, {
        question: text || 'Resumen del mes',
        summary,
        recentTransactions: recent,
        accounts: summary.accounts,
      });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, escapeHtml(answer));
      return;
    }

    if (parsed.intent !== 'record' || parsed.transactions.length === 0) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        escapeHtml(
          parsed.reply_text ||
            'No pude identificar un gasto, ingreso o transferencia. Probá con algo como: "Café 3500" o "Supermercado 40k con BBVA".'
        )
      );
      return;
    }

    for (const draft of parsed.transactions) {
      const created = await createTransaction(env.DB, {
        type: draft.type,
        amount: draft.amount,
        currency: draft.currency,
        account_id: draft.account_id,
        to_account_id: draft.to_account_id,
        category_id: draft.category_id,
        description: draft.description,
        occurred_at: draft.occurred_at,
        source,
        raw_input: text || `[${source}]`,
        telegram_message_id: message.message_id,
      });

      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        formatTransactionMessage(created, accounts, categories),
        mainTxKeyboard(created.id)
      );
    }
  } catch (err) {
    console.error('Telegram update error:', err);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ Hubo un error procesando tu mensaje. Revisá los logs o intentá de nuevo.'
    );
  }
}
