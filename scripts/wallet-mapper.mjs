import crypto from 'node:crypto';

export const ACCOUNT_MAP = {
  'Mercado Pago': 'mp',
  Efectivo: 'efectivo',
  'TC - BBVA': 'bbva_credito',
  'TC - BBVA (USD)': 'bbva_credito_usd',
  'TC - MP': 'mp_credito',
};

const EXPENSE_CATEGORY_MAP = {
  Comestibles: 'supermercado',
  'Restaurante, comida rápida': 'comida_afuera',
  'Comida y bebidas': 'kiosco_cafe',
  'Bar, cafetería': 'kiosco_cafe',
  'Alcohol, tabaco': 'kiosco_cafe',
  Salidas: 'salidas_social',
  Juntada: 'salidas_social',
  Fiesta: 'salidas_social',
  Familia: 'salidas_social',
  'Cultura, eventos deportivos': 'salidas_social',
  Pasatiempos: 'salidas_social',
  'Eventos de la vida': 'salidas_social',
  'Vida y entretenimiento': 'salidas_social',
  'Deporte activo, fitness': 'deporte',
  Taxi: 'uber_taxi',
  'Transporte público': 'transporte_publico',
  'Larga distancia': 'transporte_publico',
  Transporte: 'transporte_publico',
  Combustible: 'auto',
  Estacionamiento: 'auto',
  'Mantenimiento de vehículos': 'auto',
  'Seguro de vehículo': 'auto',
  'Software, apps, juegos': 'suscripciones',
  'Teléfono, móvil': 'suscripciones',
  'TV, Streaming': 'suscripciones',
  'Educación, desarrollo personal': 'educacion',
  'Papelería, herramientas': 'educacion',
  'Cuidado de salud, doctor': 'salud',
  'Droguería, farmacia': 'salud',
  'Salud y belleza': 'salud',
  'Bienestar, belleza': 'cuidado_personal',
  'Regalos, alegrías': 'regalos',
  'Caridad, donaciones': 'regalos',
  'Ropa y calzado': 'compras_ropa',
  'Electrónica, accesorios': 'compras_ropa',
  Compras: 'compras_ropa',
  'Joyería, accesorios': 'compras_ropa',
  Vivienda: 'servicios',
  'Mascotas, animales': 'mascotas',
};

const CREDIT_CARD_ACCOUNTS = new Set(['bbva_credito', 'bbva_credito_usd', 'mp_credito']);
const INVESTMENT_CATEGORIES = new Set(['Inversiones', 'Inversiones financieras', 'Ahorros']);
const THIRD_PARTY_EXPENSE_CATEGORIES = new Set(['Gastos de Terceros', 'Préstamos, intereses']);
const THIRD_PARTY_INCOME_CATEGORIES = new Set(['Gastos de Terceros', 'Préstamos, alquiler']);

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function slugifyTag(name) {
  return String(name ?? '')
    .trim()
    .replace(/^#/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function addMonthsYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function extractInstallments(note) {
  const text = String(note ?? '');
  if (!text) return null;

  const multMatch = text.match(/(\d{1,2})\s*[xX]\s*\$?\s*[\d.,]+/);
  if (multMatch) {
    const n = Number(multMatch[1]);
    if (n >= 2 && n <= 48) return n;
  }

  const cuotasMatch = text.match(/\b(\d{1,2})\s+cuotas?\b/i);
  if (cuotasMatch) {
    const n = Number(cuotasMatch[1]);
    if (n >= 2 && n <= 48) return n;
  }

  return null;
}

function extractThirdPartyName(note, payee) {
  const p = String(payee ?? '').trim();
  if (p) return p.slice(0, 60);
  const text = String(note ?? '').trim();
  if (!text) return null;

  const arrowMatch = text.match(/(?:Yo\s*→\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+)|([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s*→\s*Yo)/i);
  if (arrowMatch) {
    const name = arrowMatch[1] || arrowMatch[2];
    if (name) return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  const parteMatch = text.match(/\bparte\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\b/i);
  if (parteMatch) {
    const name = parteMatch[1];
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  for (const known of ['Jere', 'Carlos', 'Mario', 'Germán', 'German', 'Nato', 'Abril']) {
    if (new RegExp(`\\b${known}\\b`, 'i').test(text)) {
      return known === 'German' ? 'Germán' : known;
    }
  }
  return null;
}

function extractTags(labelsRaw, category, note) {
  const tags = new Set();
  if (labelsRaw) {
    for (const part of String(labelsRaw).split(/[,;|]+/)) {
      const slug = slugifyTag(part);
      if (slug) tags.add(slug);
    }
  }
  if (category === 'Familia') tags.add('familia');
  if (category === 'Vacaciones, viajes, hoteles') tags.add('vacaciones');
  if (/^(?:VENTA\s+)?HW\s*:/i.test(String(note ?? '').trim())) tags.add('hw');
  return Array.from(tags);
}

function deterministicId(seed) {
  return 'w_' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 10);
}

export function mapWalletRows(rawRows) {
  const rawAccountSums = {};
  const transferOuts = [];
  const transferIns = [];
  const nonTransfers = [];

  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const accountId = ACCOUNT_MAP[row.account];
    if (!accountId) {
      throw new Error(`Cuenta desconocida en fila ${idx + 1}: "${row.account}"`);
    }
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount) || amount === 0) continue;

    rawAccountSums[accountId] = round2((rawAccountSums[accountId] ?? 0) + amount);
    const currency = accountId === 'bbva_credito_usd' ? 'USD' : 'ARS';
    const item = {
      ...row,
      idx,
      accountId,
      currency,
      amount: round2(amount),
      absAmount: round2(Math.abs(amount)),
      note: String(row.note ?? '').trim(),
      category: String(row.category ?? '').trim(),
      labels: String(row.labels ?? '').trim(),
      payee: String(row.payee ?? '').trim(),
    };

    if (Number(row.transfer || 0) === 1) {
      if (item.amount < 0) transferOuts.push(item);
      else transferIns.push(item);
    } else {
      nonTransfers.push(item);
    }
  }

  const transactions = [];
  const usedIns = new Set();
  let pairedTransfersCount = 0;
  let orphanTransfersCount = 0;
  const maxPairWindowMs = 48 * 3600 * 1000;

  for (const out of transferOuts) {
    let bestIdx = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < transferIns.length; i++) {
      if (usedIns.has(i)) continue;
      const candidate = transferIns[i];
      if (candidate.accountId === out.accountId) continue;
      if (candidate.currency !== out.currency) continue;
      if (candidate.absAmount !== out.absAmount) continue;
      const diff = Math.abs(candidate.timestampMs - out.timestampMs);
      if (diff <= maxPairWindowMs && diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      usedIns.add(bestIdx);
      pairedTransfersCount++;
      const matchedIn = transferIns[bestIdx];
      const desc = out.note || matchedIn.note || 'Transferencia';
      const tags = Array.from(
        new Set([
          ...extractTags(out.labels, out.category, out.note),
          ...extractTags(matchedIn.labels, matchedIn.category, matchedIn.note),
        ])
      );

      transactions.push({
        id: deterministicId(`tr:${out.idx}:${matchedIn.idx}:${out.dateIso}:${out.absAmount}`),
        type: 'transfer',
        amount: out.absAmount,
        currency: out.currency,
        account_id: out.accountId,
        to_account_id: matchedIn.accountId,
        category_id: null,
        description: desc.slice(0, 140),
        occurred_at: out.dateIso,
        source: 'wallet_import',
        raw_input: `${out.account} -> ${matchedIn.account}`,
        installments_total: null,
        first_installment_month: null,
        third_party_name: null,
        linked_group_id: null,
        tags,
        created_at: out.isoTimestamp,
      });
    } else {
      orphanTransfersCount++;
      transactions.push({
        id: deterministicId(`adj_tr:${out.idx}:${out.dateIso}:${out.amount}`),
        type: 'adjustment',
        amount: out.amount,
        currency: out.currency,
        account_id: out.accountId,
        to_account_id: null,
        category_id: null,
        description: (out.note || 'Ajuste de saldo').slice(0, 140),
        occurred_at: out.dateIso,
        source: 'wallet_import',
        raw_input: 'TRANSFER_ORPHAN',
        installments_total: null,
        first_installment_month: null,
        third_party_name: null,
        linked_group_id: null,
        tags: extractTags(out.labels, out.category, out.note),
        created_at: out.isoTimestamp,
      });
    }
  }

  for (let i = 0; i < transferIns.length; i++) {
    if (usedIns.has(i)) continue;
    const lonelyIn = transferIns[i];
    orphanTransfersCount++;
    transactions.push({
      id: deterministicId(`adj_trin:${lonelyIn.idx}:${lonelyIn.dateIso}:${lonelyIn.amount}`),
      type: 'adjustment',
      amount: lonelyIn.amount,
      currency: lonelyIn.currency,
      account_id: lonelyIn.accountId,
      to_account_id: null,
      category_id: null,
      description: (lonelyIn.note || 'Ajuste de saldo').slice(0, 140),
      occurred_at: lonelyIn.dateIso,
      source: 'wallet_import',
      raw_input: 'TRANSFER_ORPHAN',
      installments_total: null,
      first_installment_month: null,
      third_party_name: null,
      linked_group_id: null,
      tags: extractTags(lonelyIn.labels, lonelyIn.category, lonelyIn.note),
      created_at: lonelyIn.isoTimestamp,
    });
  }

  for (const row of nonTransfers) {
    const tags = extractTags(row.labels, row.category, row.note);
    const isCard = CREDIT_CARD_ACCOUNTS.has(row.accountId);
    let type;
    let amount = row.absAmount;
    let categoryId = null;
    let thirdPartyName = null;
    let installmentsTotal = null;
    let firstInstallmentMonth = null;

    if (row.amount < 0) {
      if (INVESTMENT_CATEGORIES.has(row.category)) {
        type = 'investment';
      } else if (THIRD_PARTY_EXPENSE_CATEGORIES.has(row.category)) {
        type = 'third_party';
        thirdPartyName = extractThirdPartyName(row.note, row.payee);
      } else if (row.category === 'Faltante') {
        type = 'adjustment';
        amount = row.amount; // negative signed
      } else {
        type = 'expense';
        categoryId = EXPENSE_CATEGORY_MAP[row.category] ?? 'otros';
      }

      if (isCard && (type === 'expense' || type === 'third_party')) {
        installmentsTotal = extractInstallments(row.note);
        if (installmentsTotal) {
          firstInstallmentMonth = addMonthsYm(row.dateIso.slice(0, 7), 1);
        }
      }
    } else {
      const isThirdPartyIncome =
        THIRD_PARTY_INCOME_CATEGORIES.has(row.category) ||
        /\bjere\b.*\bcuota\b/i.test(row.note);

      if (isThirdPartyIncome) {
        type = 'third_party_repayment';
        thirdPartyName = extractThirdPartyName(row.note, row.payee);
      } else {
        type = 'income';
        if (row.category === 'Intereses, dividendos') {
          categoryId = 'rendimientos';
        } else if (
          row.category === 'Reembolsos (impuestos, compras)' ||
          /\b(?:reintegro|descuento cuenta dni)\b/i.test(row.note)
        ) {
          categoryId = 'reintegros';
        } else if (
          row.category === 'Ingreso' &&
          /\b(?:teckdes|laburo|aguinaldo|sueldo)\b/i.test(row.note)
        ) {
          categoryId = 'sueldo';
        } else {
          categoryId = 'otros_ingresos';
        }
      }
    }

    transactions.push({
      id: deterministicId(`tx:${row.idx}:${row.dateIso}:${row.accountId}:${row.amount}`),
      type,
      amount,
      currency: row.currency,
      account_id: row.accountId,
      to_account_id: null,
      category_id: categoryId,
      description: (row.note || row.category || 'Movimiento').slice(0, 140),
      occurred_at: row.dateIso,
      source: 'wallet_import',
      raw_input: row.category || null,
      installments_total: installmentsTotal,
      first_installment_month: firstInstallmentMonth,
      third_party_name: thirdPartyName,
      linked_group_id: null,
      tags,
      created_at: row.isoTimestamp,
    });
  }

  // Audit mapped balances vs raw Excel sums using exact v2 double-entry rules
  const mappedAccountSums = {};
  for (const tx of transactions) {
    if (tx.type === 'income' || tx.type === 'third_party_repayment' || tx.type === 'adjustment') {
      mappedAccountSums[tx.account_id] = round2((mappedAccountSums[tx.account_id] ?? 0) + tx.amount);
    } else if (tx.type === 'expense' || tx.type === 'investment' || tx.type === 'third_party') {
      mappedAccountSums[tx.account_id] = round2((mappedAccountSums[tx.account_id] ?? 0) - tx.amount);
    } else if (tx.type === 'transfer') {
      mappedAccountSums[tx.account_id] = round2((mappedAccountSums[tx.account_id] ?? 0) - tx.amount);
      if (tx.to_account_id) {
        mappedAccountSums[tx.to_account_id] = round2(
          (mappedAccountSums[tx.to_account_id] ?? 0) + tx.amount
        );
      }
    }
  }

  const allAccountIds = Array.from(
    new Set([...Object.keys(rawAccountSums), ...Object.keys(mappedAccountSums)])
  ).sort();

  const balanceAudit = allAccountIds.map((accountId) => {
    const rawSum = round2(rawAccountSums[accountId] ?? 0);
    const mappedSum = round2(mappedAccountSums[accountId] ?? 0);
    return {
      account_id: accountId,
      raw_sum: rawSum,
      mapped_sum: mappedSum,
      diff: round2(mappedSum - rawSum),
    };
  });

  return {
    transactions,
    stats: {
      raw_rows: rawRows.length,
      mapped_transactions: transactions.length,
      paired_transfers: pairedTransfersCount,
      orphan_transfers_as_adjustments: orphanTransfersCount,
    },
    balanceAudit,
  };
}
