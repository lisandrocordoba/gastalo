import type {
  AccountWithBalance,
  Category,
  Env,
  OverdueCardAlert,
  Tag,
  Transaction,
} from './types';
import {
  ConflictError,
  createAccount,
  createCategory,
  createSharedPurchase,
  createTag,
  createTransaction,
  deleteAccount,
  deleteCategory,
  deleteTag,
  deleteTransaction,
  getFutureProjection,
  getMonthSummary,
  getTransactionById,
  listAccountsWithBalances,
  listCategories,
  listTags,
  listTransactions,
  updateTransaction,
} from './db';
import { answerFinancialQuery, parseMessageWithGemini } from './gemini';
import {
  addMonths,
  arrayBufferToBase64,
  currentMonthInTimezone,
  defaultColorForAccountType,
  formatCurrency,
  todayInTimezone,
} from './utils';

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

function findSavingsAccount(
  accounts: AccountWithBalance[],
  excludeAccountId: string,
  currency?: string
): AccountWithBalance | undefined {
  const candidates = accounts.filter((a) => a.type === 'savings' && a.id !== excludeAccountId);
  if (candidates.length === 0) return undefined;
  if (currency) {
    const exact = candidates.find((a) => a.currency === currency);
    if (exact) return exact;
  }
  return candidates[0];
}

function mainTxKeyboard(
  tx: Transaction,
  accounts: AccountWithBalance[],
  options: { movedToReservas?: boolean } = {}
): InlineButton[][] {
  const row1: InlineButton[] = [{ text: '✅ OK', callback_data: `ok:${tx.id}` }];
  if (tx.type === 'expense' || tx.type === 'income') {
    row1.push({ text: '✏️ Categoría', callback_data: `catm:${tx.id}` });
  }

  const row2: InlineButton[] = [
    { text: '🔄 Cuenta', callback_data: `accm:${tx.id}` },
    { text: '🏷️ Etiquetas', callback_data: `tagm:${tx.id}` },
  ];

  const rows: InlineButton[][] = [row1, row2];

  const savingsAcc = findSavingsAccount(accounts, tx.account_id, tx.currency);
  if (tx.type === 'third_party_repayment' && savingsAcc && !options.movedToReservas) {
    rows.push([{ text: `🛡️ Pasar a ${savingsAcc.name}`, callback_data: `resv:${tx.id}` }]);
  }

  rows.push([{ text: '🗑️ Borrar', callback_data: `del:${tx.id}` }]);
  return rows;
}

function headerForType(type: Transaction['type']): string {
  switch (type) {
    case 'income':
      return '💚 <b>Ingreso registrado</b>';
    case 'transfer':
      return '🔁 <b>Transferencia registrada</b>';
    case 'investment':
      return '🪙 <b>Inversión registrada</b>';
    case 'third_party':
      return '🤝 <b>Gasto de tercero registrado</b>';
    case 'third_party_repayment':
      return '💸 <b>Reembolso de tercero registrado</b>';
    case 'adjustment':
      return '⚖️ <b>Ajuste de saldo registrado</b>';
    default:
      return '🧾 <b>Gasto registrado</b>';
  }
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

  const lines = [
    headerForType(tx.type),
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

  if (tx.third_party_name) {
    lines.push(`• <b>Tercero:</b> ${escapeHtml(tx.third_party_name)}`);
  }

  if (tx.installments_total && tx.installments_total > 1) {
    const perCuota = tx.amount / tx.installments_total;
    const fromMonth = tx.first_installment_month ? ` desde ${tx.first_installment_month}` : '';
    lines.push(
      `• <b>Cuotas:</b> ${tx.installments_total}x ${formatCurrency(perCuota, tx.currency)}${fromMonth}`
    );
  }

  if (tx.tags.length > 0) {
    lines.push(`• <b>Etiquetas:</b> ${tx.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}`);
  }

  lines.push(`• <b>Fecha:</b> ${tx.occurred_at}`);
  if (tx.statement_month) {
    lines.push(`• <b>Resumen:</b> ${tx.statement_month}`);
  }
  if (tx.budget_month && tx.budget_month !== tx.occurred_at.slice(0, 7)) {
    lines.push(`• <b>Mes contable:</b> ${tx.budget_month}`);
  }
  if (statusLine) {
    lines.push(`\n${statusLine}`);
  }
  return lines.join('\n');
}

function formatBalancesText(accounts: AccountWithBalance[]): string {
  if (accounts.length === 0) {
    return '🏦 <b>Sin cuentas configuradas</b>\n\nTodavía no creaste ninguna cuenta o tarjeta. Creá una escribiendo por ejemplo:\n<i>"Creá mi cuenta principal Billetera en ARS"</i>';
  }

  const lines = ['🏦 <b>Saldos actuales</b>\n'];
  let liquidArs = 0;
  let savingsArs = 0;
  let debtArs = 0;
  const otherCurrencies: AccountWithBalance[] = [];

  for (const acc of accounts) {
    if (acc.currency !== 'ARS') {
      otherCurrencies.push(acc);
      continue;
    }
    const emoji =
      acc.type === 'credit_card'
        ? '💳'
        : acc.type === 'savings'
          ? '🛡️'
          : acc.type === 'cash'
            ? '💵'
            : '🟦';
    const defaultBadge = acc.is_default ? ' ⭐' : '';
    const dueBadge =
      acc.type === 'credit_card' && acc.due_day ? ` <i>(vence día ${acc.due_day})</i>` : '';
    lines.push(
      `${emoji} <b>${escapeHtml(acc.name)}${defaultBadge}:</b> ${formatCurrency(acc.balance, acc.currency)}${dueBadge}`
    );
    if (acc.type === 'wallet' || acc.type === 'cash') liquidArs += acc.balance;
    else if (acc.type === 'savings') savingsArs += acc.balance;
    else if (acc.type === 'credit_card') debtArs += acc.balance;
  }

  lines.push('');
  lines.push(`💧 <b>Disponible (Cuentas + Efectivo):</b> ${formatCurrency(liquidArs)}`);
  if (savingsArs !== 0 || accounts.some((a) => a.type === 'savings' && a.currency === 'ARS')) {
    lines.push(`🛡️ <b>Reservas / Ahorros:</b> ${formatCurrency(savingsArs)}`);
  }
  lines.push(`📊 <b>Patrimonio neto ARS:</b> ${formatCurrency(liquidArs + savingsArs + debtArs)}`);

  if (otherCurrencies.length > 0) {
    lines.push('');
    for (const acc of otherCurrencies) {
      const emoji = acc.type === 'credit_card' ? '💳' : '💵';
      const dueBadge =
        acc.type === 'credit_card' && acc.due_day ? ` <i>(vence día ${acc.due_day})</i>` : '';
      lines.push(
        `${emoji} <b>${escapeHtml(acc.name)}:</b> ${formatCurrency(acc.balance, acc.currency)}${dueBadge}`
      );
    }
  }

  return lines.join('\n');
}

function formatOverdueAlertsLines(alerts: OverdueCardAlert[]): string[] {
  if (alerts.length === 0) return [];
  const lines = ['\n🚨 <b>Resúmenes vencidos sin pagar:</b>'];
  for (const a of alerts) {
    lines.push(
      `• ${escapeHtml(a.account_name)} (${a.statement_month}): venció ${a.due_date} · ${formatCurrency(a.total_due, a.currency)}`
    );
  }
  return lines;
}

async function handleCommand(env: Env, chatId: number, command: string): Promise<void> {
  const tz = env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const defaultCurrency = env.DEFAULT_CURRENCY || 'ARS';
  const cmd = command.split(/\s+/)[0].toLowerCase();

  if (cmd === '/start' || cmd === '/ayuda' || cmd === '/help') {
    const text = [
      '👋 <b>¡Hola! Soy tu asistente financiero personal.</b>',
      '',
      '<b>1. Configurá tus cuentas por chat o desde el Dashboard:</b>',
      '• <i>"Creá mi cuenta principal Banco Nación en ARS"</i>',
      '• <i>"Agregá tarjeta de crédito Visa en pesos"</i>',
      '• <i>"Creá cuenta de ahorros Reservas en ARS"</i>',
      '• <i>"Agregá la categoría Gimnasio"</i> · <i>"Creá la etiqueta #viaje"</i>',
      '',
      '<b>2. Cargá tus movimientos con texto, audio o foto:</b>',
      '• <b>Gastos y tags:</b> <i>"Café 3500 hormiga"</i>, <i>"Supermercado 45k"</i>',
      '• <b>Cuotas y compartidos:</b> <i>"Zapatillas 90k en 3 cuotas con Visa"</i>, <i>"Cena 40k mitad con Juan"</i>',
      '• <b>Inversión / Transferencia:</b> <i>"Invertí 100k en CEDEAR"</i>',
      '• <b>Consultas:</b> <i>"¿Cuánto gasté este mes?"</i>',
      '',
      '<b>Comandos útiles:</b>',
      '/cuentas — Ver y gestionar cuentas y tarjetas',
      '/resumen — Resumen del período actual',
      '/saldos — Saldos de todas tus cuentas y tarjetas',
      '/futuro — Cuotas y gastos fijos próximos vs. reservas',
      '/ultimos — Últimos 5 movimientos',
    ].join('\n');

    const keyboard: InlineButton[][] | undefined = env.DASHBOARD_URL
      ? [[{ text: '📊 Abrir Dashboard', web_app: { url: env.DASHBOARD_URL } }]]
      : undefined;

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, keyboard);
    return;
  }

  if (cmd === '/cuentas' || cmd === '/config') {
    const accounts = await listAccountsWithBalances(env.DB);
    const lines = [formatBalancesText(accounts)];
    lines.push(
      '\n⚙️ <b>Para crear por chat:</b>\n• <i>"Creá cuenta Billetera Digital en ARS"</i>\n• <i>"Agregá tarjeta Mastercard en USD"</i>\n• <i>"Creá categoría Mascotas"</i> o <i>"Creá etiqueta #viaje"</i>'
    );
    const keyboard: InlineButton[][] | undefined = env.DASHBOARD_URL
      ? [[{ text: '⚙️ Configurar en Dashboard', web_app: { url: env.DASHBOARD_URL } }]]
      : undefined;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'), keyboard);
    return;
  }

  if (cmd === '/saldos') {
    const today = todayInTimezone(tz);
    const month = today.slice(0, 7);
    const summary = await getMonthSummary(env.DB, month, 'cash', today);
    const lines = [formatBalancesText(summary.accounts)];
    lines.push(...formatOverdueAlertsLines(summary.overdue_card_alerts));
    if (summary.third_party_by_person.length > 0) {
      lines.push('\n🤝 <b>Pendiente de terceros (te deben):</b>');
      for (const p of summary.third_party_by_person) {
        lines.push(`• ${escapeHtml(p.person)}: ${formatCurrency(p.pending)}`);
      }
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
    return;
  }

  if (cmd === '/resumen' || cmd === '/mes') {
    const today = todayInTimezone(tz);
    const month = today.slice(0, 7);
    const summary = await getMonthSummary(env.DB, month, 'cash', today);
    const lines = [
      `📅 <b>Resumen ${month}</b>\n`,
      `💚 <b>Ingresos:</b> ${formatCurrency(summary.income)}`,
      `💸 <b>Gastos consumo:</b> ${formatCurrency(summary.expense)}`,
    ];
    if (summary.card_purchases > 0) {
      lines.push(`💳 <b>Compras con TC:</b> ${formatCurrency(summary.card_purchases)}`);
    }
    if (summary.investment > 0) {
      lines.push(`🪙 <b>Invertido:</b> ${formatCurrency(summary.investment)}`);
    }
    lines.push(`⚖️ <b>Balance (Ingresos - Gastos):</b> ${formatCurrency(summary.net)}`);
    if (summary.usd_expense > 0) {
      lines.push(`💵 <b>Gastos USD:</b> ${formatCurrency(summary.usd_expense, 'USD')}`);
    }

    lines.push(...formatOverdueAlertsLines(summary.overdue_card_alerts));

    if (summary.by_category.length > 0) {
      lines.push('\n<b>Top categorías:</b>');
      for (const c of summary.by_category.slice(0, 6)) {
        lines.push(`${c.icon} ${escapeHtml(c.name)}: ${formatCurrency(c.total)} (${c.percentage}%)`);
      }
    }

    if (summary.by_tag.length > 0) {
      lines.push('\n<b>Por etiqueta:</b>');
      for (const t of summary.by_tag.slice(0, 5)) {
        lines.push(`#${escapeHtml(t.name)}: ${formatCurrency(t.total)} (${t.percentage}%)`);
      }
    }

    if (summary.third_party_by_person.length > 0) {
      lines.push('\n🤝 <b>Pendiente de terceros:</b>');
      for (const p of summary.third_party_by_person) {
        lines.push(`• ${escapeHtml(p.person)}: ${formatCurrency(p.pending)}`);
      }
    }

    lines.push('\n' + formatBalancesText(summary.accounts));
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
    return;
  }

  if (cmd === '/futuro') {
    const nextMonth = addMonths(currentMonthInTimezone(tz), 1);
    const proj = await getFutureProjection(env.DB, nextMonth, 3, defaultCurrency);
    const lines = ['🔮 <b>Proyección próximos 3 meses</b>\n'];

    for (const m of proj.months) {
      const usdPart =
        m.recurring_usd_total_amount > 0
          ? ` + ${formatCurrency(m.recurring_usd_total_amount, 'USD')}`
          : '';
      lines.push(
        `📅 <b>${m.month}:</b> ${formatCurrency(m.total_committed)} <i>(Cuotas ${formatCurrency(m.installments_total_amount)} + Fijos ${formatCurrency(m.recurring_total_amount)}${usdPart})</i>`
      );
      for (const inst of m.installments.slice(0, 5)) {
        lines.push(
          `   • ${escapeHtml(inst.description)} (${inst.installment_number}/${inst.installments_total}): ${formatCurrency(inst.installment_amount)}`
        );
      }
    }

    lines.push('');
    lines.push(`🛡️ <b>Saldo en reservas/ahorros:</b> ${formatCurrency(proj.reservas_balance)}`);
    if (proj.next_month_coverage_delta >= 0) {
      lines.push(
        `✅ <b>Próximo mes cubierto</b> (sobran ${formatCurrency(proj.next_month_coverage_delta)})`
      );
    } else {
      lines.push(
        `⚠️ <b>Falta reservar para ${nextMonth}:</b> ${formatCurrency(Math.abs(proj.next_month_coverage_delta))}`
      );
    }

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
      const sign =
        tx.type === 'income' || tx.type === 'third_party_repayment'
          ? '+'
          : tx.type === 'transfer'
            ? '🔁'
            : tx.type === 'investment'
              ? '🪙'
              : '-';
      const label =
        tx.type === 'transfer'
          ? `${accMap.get(tx.account_id) ?? tx.account_id} → ${accMap.get(tx.to_account_id ?? '') ?? ''}`
          : `${catMap.get(tx.category_id ?? '') ?? tx.type} · ${accMap.get(tx.account_id) ?? tx.account_id}`;
      const tagStr = tx.tags.length > 0 ? ` · ${tx.tags.map((t) => `#${t}`).join(' ')}` : '';
      lines.push(
        `${sign} <b>${formatCurrency(tx.amount, tx.currency)}</b> — ${escapeHtml(tx.description)}\n   <i>${tx.occurred_at} · ${escapeHtml(label)}${escapeHtml(tagStr)}</i>`
      );
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
  }
}

async function renderTagMenu(
  token: string,
  chatId: number,
  messageId: number,
  tx: Transaction,
  tags: Tag[]
): Promise<void> {
  const active = new Set(tx.tags);
  const rows: InlineButton[][] = [];
  for (let i = 0; i < tags.length; i += 2) {
    rows.push(
      tags.slice(i, i + 2).map((t) => ({
        text: `${active.has(t.id) ? '✅ ' : ''}#${t.name}`,
        callback_data: `tagt:${tx.id}:${t.id.slice(0, 40)}`,
      }))
    );
  }
  rows.push([{ text: '⬅️ Volver', callback_data: `back:${tx.id}` }]);
  await editMessageText(
    token,
    chatId,
    messageId,
    '🏷️ <b>Tocá las etiquetas para activar/quitar:</b>',
    rows
  );
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
      { text: `${a.name} (${a.currency})`, callback_data: `acc:${txId}:${a.id}` },
    ]);
    rows.push([{ text: '⬅️ Volver', callback_data: `back:${txId}` }]);
    await editMessageText(token, msg.chat.id, msg.message_id, '🏦 <b>Elegí la cuenta:</b>', rows);
    await answerCallbackQuery(token, cb.id);
    return;
  }

  if (action === 'tagm') {
    const [tx, tags] = await Promise.all([getTransactionById(env.DB, txId), listTags(env.DB)]);
    if (!tx) {
      await answerCallbackQuery(token, cb.id, 'Movimiento no encontrado');
      return;
    }
    await renderTagMenu(token, msg.chat.id, msg.message_id, tx, tags);
    await answerCallbackQuery(token, cb.id);
    return;
  }

  if (action === 'tagt' && param) {
    const [tx, tags] = await Promise.all([getTransactionById(env.DB, txId), listTags(env.DB)]);
    if (!tx) {
      await answerCallbackQuery(token, cb.id, 'Movimiento no encontrado');
      return;
    }
    const nextTags = tx.tags.includes(param)
      ? tx.tags.filter((t) => t !== param)
      : [...tx.tags, param];
    const updated = await updateTransaction(env.DB, txId, { tags: nextTags });
    if (updated) {
      await renderTagMenu(token, msg.chat.id, msg.message_id, updated, tags);
    }
    await answerCallbackQuery(token, cb.id, tx.tags.includes(param) ? 'Etiqueta quitada' : 'Etiqueta agregada');
    return;
  }

  if (action === 'delacc') {
    try {
      const deleted = await deleteAccount(env.DB, txId);
      await editMessageText(
        token,
        msg.chat.id,
        msg.message_id,
        deleted ? '🗑️ <i>Cuenta eliminada.</i>' : '⚠️ <i>La cuenta ya no existe.</i>'
      );
      await answerCallbackQuery(token, cb.id, deleted ? 'Eliminada' : 'No encontrada');
    } catch (err) {
      const msgErr = err instanceof ConflictError ? err.message : 'No se pudo eliminar la cuenta';
      await answerCallbackQuery(token, cb.id, msgErr.slice(0, 180));
    }
    return;
  }

  if (action === 'delcat') {
    try {
      const deleted = await deleteCategory(env.DB, txId);
      await editMessageText(
        token,
        msg.chat.id,
        msg.message_id,
        deleted ? '🗑️ <i>Categoría eliminada.</i>' : '⚠️ <i>La categoría ya no existe.</i>'
      );
      await answerCallbackQuery(token, cb.id, deleted ? 'Eliminada' : 'No encontrada');
    } catch (err) {
      const msgErr = err instanceof ConflictError ? err.message : 'No se pudo eliminar la categoría';
      await answerCallbackQuery(token, cb.id, msgErr.slice(0, 180));
    }
    return;
  }

  if (action === 'deltag') {
    const deleted = await deleteTag(env.DB, txId);
    await editMessageText(
      token,
      msg.chat.id,
      msg.message_id,
      deleted ? '🗑️ <i>Etiqueta eliminada.</i>' : '⚠️ <i>La etiqueta ya no existe.</i>'
    );
    await answerCallbackQuery(token, cb.id, deleted ? 'Eliminada' : 'No encontrada');
    return;
  }

  if (action === 'resv') {
    const [tx, accounts, categories] = await Promise.all([
      getTransactionById(env.DB, txId),
      listAccountsWithBalances(env.DB),
      listCategories(env.DB),
    ]);
    if (!tx) {
      await answerCallbackQuery(token, cb.id, 'Movimiento no encontrado');
      return;
    }
    const savingsAcc = findSavingsAccount(accounts, tx.account_id, tx.currency);
    if (!savingsAcc) {
      await answerCallbackQuery(token, cb.id, 'No hay una cuenta de reservas/ahorro configurada');
      return;
    }
    const tz = env.TIMEZONE || 'America/Argentina/Buenos_Aires';
    await createTransaction(env.DB, {
      type: 'transfer',
      amount: tx.amount,
      currency: tx.currency,
      account_id: tx.account_id,
      to_account_id: savingsAcc.id,
      description: `Reserva (${tx.description})`,
      occurred_at: todayInTimezone(tz),
      source: 'telegram_button',
    });
    await editMessageText(
      token,
      msg.chat.id,
      msg.message_id,
      formatTransactionMessage(
        tx,
        accounts,
        categories,
        `🛡️ <i>Pasado a ${escapeHtml(savingsAcc.name)}</i>`
      ),
      mainTxKeyboard(tx, accounts, { movedToReservas: true })
    );
    await answerCallbackQuery(token, cb.id, `Pasado a ${savingsAcc.name}`);
    return;
  }

  if (action === 'cat' && param) {
    await updateTransaction(env.DB, txId, { category_id: param });
  } else if (action === 'acc' && param) {
    const accList = await listAccountsWithBalances(env.DB);
    const targetAcc = accList.find((a) => a.id === param);
    await updateTransaction(env.DB, txId, {
      account_id: param,
      ...(targetAcc ? { currency: targetAcc.currency } : {}),
    });
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
    mainTxKeyboard(tx, accounts)
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
    const [accounts, categories, tags] = await Promise.all([
      listAccountsWithBalances(env.DB),
      listCategories(env.DB),
      listTags(env.DB),
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
      tags,
      today,
    });

    if (parsed.intent === 'manage' && parsed.operations.length > 0) {
      for (const op of parsed.operations) {
        if (op.action === 'create_account') {
          const created = await createAccount(env.DB, {
            name: op.name,
            type: op.account_type,
            currency: op.currency,
            initial_balance: op.initial_balance,
            color: defaultColorForAccountType(op.account_type),
            is_default: op.is_default ? 1 : 0,
            due_day: op.due_day,
          });
          const typeLabel =
            created.type === 'credit_card'
              ? 'Tarjeta de crédito'
              : created.type === 'savings'
                ? 'Reservas / Ahorro'
                : created.type === 'cash'
                  ? 'Efectivo'
                  : 'Billetera / Banco';
          const infoLines = [
            '✅ <b>Cuenta creada</b>',
            `• <b>Nombre:</b> ${escapeHtml(created.name)}${created.is_default ? ' ⭐ (Principal)' : ''}`,
            `• <b>Tipo:</b> ${typeLabel} (${created.currency})`,
            `• <b>Saldo inicial:</b> ${formatCurrency(created.initial_balance, created.currency)}`,
          ];
          if (created.due_day) {
            infoLines.push(`• <b>Vencimiento:</b> día ${created.due_day}`);
          }
          await sendMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            infoLines.join('\n'),
            [[{ text: '🗑️ Eliminar', callback_data: `delacc:${created.id}` }]]
          );
        } else if (op.action === 'create_category') {
          const created = await createCategory(env.DB, {
            name: op.name,
            icon: op.icon,
            type: op.category_type,
            color: op.color,
          });
          await sendMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            `✅ <b>Categoría creada:</b> ${created.icon} ${escapeHtml(created.name)} (${created.type})`,
            [[{ text: '🗑️ Eliminar', callback_data: `delcat:${created.id}` }]]
          );
        } else if (op.action === 'create_tag') {
          const created = await createTag(env.DB, op.name, op.color);
          await sendMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            `✅ <b>Etiqueta creada:</b> #${escapeHtml(created.name)}`,
            [[{ text: '🗑️ Eliminar', callback_data: `deltag:${created.id}` }]]
          );
        }
      }
      return;
    }

    if (parsed.intent === 'query') {
      const month = today.slice(0, 7);
      const nextMonth = addMonths(month, 1);
      const defaultCurrency = env.DEFAULT_CURRENCY || 'ARS';
      const [summary, recent, projection] = await Promise.all([
        getMonthSummary(env.DB, month, 'cash', today),
        listTransactions(env.DB, { month, limit: 30 }),
        getFutureProjection(env.DB, nextMonth, 3, defaultCurrency),
      ]);
      const answer = await answerFinancialQuery(env, {
        question: text || 'Resumen del mes',
        summary,
        recentTransactions: recent,
        accounts: summary.accounts,
        projection,
      });
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, escapeHtml(answer));
      return;
    }

    if (accounts.length === 0) {
      const keyboard: InlineButton[][] | undefined = env.DASHBOARD_URL
        ? [[{ text: '⚙️ Configurar en Dashboard', web_app: { url: env.DASHBOARD_URL } }]]
        : undefined;
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        [
          '🏦 <b>Todavía no tenés cuentas creadas.</b>',
          '',
          'Creá tu primera cuenta escribiéndome algo como:',
          '• <i>"Creá mi cuenta principal Billetera en ARS"</i>',
          '• <i>"Agregá tarjeta de crédito Visa en ARS"</i>',
          '',
          'O configuralas desde el Dashboard.',
        ].join('\n'),
        keyboard
      );
      return;
    }

    if (parsed.intent !== 'record' || parsed.transactions.length === 0) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        escapeHtml(
          parsed.reply_text ||
            'No pude identificar un movimiento ni una acción. Probá con: "Café 3500", "Creá cuenta Galicia en ARS" o usá /ayuda.'
        )
      );
      return;
    }

    for (const draft of parsed.transactions) {
      if (
        draft.type === 'expense' &&
        draft.shared_third_party_amount &&
        draft.shared_third_party_amount > 0 &&
        draft.third_party_name
      ) {
        const ownAmount = Math.round((draft.amount - draft.shared_third_party_amount) * 100) / 100;
        const shared = await createSharedPurchase(env.DB, {
          account_id: draft.account_id,
          currency: draft.currency,
          category_id: draft.category_id,
          description: draft.description,
          occurred_at: draft.occurred_at,
          own_amount: ownAmount,
          third_party_amount: draft.shared_third_party_amount,
          third_party_name: draft.third_party_name,
          installments_total: draft.installments_total,
          first_installment_month: draft.first_installment_month,
          tags: draft.tags,
          source,
          raw_input: text || `[${source}]`,
          telegram_message_id: message.message_id,
        });

        for (const created of shared.transactions) {
          await sendMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            formatTransactionMessage(created, accounts, categories, '🔗 <i>Compra compartida vinculada</i>'),
            mainTxKeyboard(created, accounts)
          );
        }
        continue;
      }

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
        installments_total: draft.installments_total,
        first_installment_month: draft.first_installment_month,
        statement_month: draft.statement_month,
        budget_month: draft.budget_month,
        third_party_name: draft.third_party_name,
        tags: draft.tags,
      });

      const savingsAcc = findSavingsAccount(accounts, created.account_id, created.currency);
      const statusHint =
        created.type === 'third_party_repayment' && savingsAcc
          ? `💡 <i>Si corresponde a cuotas futuras, podés pasarlo a ${escapeHtml(savingsAcc.name)}:</i>`
          : undefined;

      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        formatTransactionMessage(created, accounts, categories, statusHint),
        mainTxKeyboard(created, accounts)
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
