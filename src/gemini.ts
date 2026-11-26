import { GoogleGenAI } from '@google/genai';
import type {
  AccountWithBalance,
  Category,
  Env,
  FutureProjection,
  MonthSummary,
  ParsedIntent,
  ParsedTransactionDraft,
  Tag,
  Transaction,
  TransactionType,
} from './types';
import { addMonths, formatCurrency, slugifyTag } from './utils';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['record', 'query', 'unknown'],
      description: 'record si reporta movimientos financieros, query si pregunta datos, unknown si no se entiende',
    },
    reply_text: {
      type: 'string',
      description: 'Solo completar si intent es unknown para guiar brevemente al usuario en español',
    },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['expense', 'income', 'transfer', 'investment', 'third_party', 'third_party_repayment'],
          },
          amount: { type: 'number' },
          currency: { type: 'string', enum: ['ARS', 'USD'] },
          account_id: { type: 'string' },
          to_account_id: { type: ['string', 'null'] },
          category_id: { type: ['string', 'null'] },
          description: { type: 'string' },
          occurred_at: { type: 'string', description: 'Fecha YYYY-MM-DD' },
          tags: { type: 'array', items: { type: 'string' } },
          installments_total: { type: ['integer', 'null'] },
          first_installment_month: { type: ['string', 'null'], description: 'Mes YYYY-MM o null' },
          third_party_name: { type: ['string', 'null'] },
          shared_third_party_amount: { type: ['number', 'null'] },
        },
        required: ['type', 'amount', 'currency', 'account_id', 'description', 'occurred_at', 'tags'],
      },
    },
  },
  required: ['intent', 'transactions'],
};

const PARSABLE_TYPES = new Set<TransactionType>([
  'expense',
  'income',
  'transfer',
  'investment',
  'third_party',
  'third_party_repayment',
]);

interface RawParsedTransaction {
  type?: unknown;
  amount?: unknown;
  currency?: unknown;
  account_id?: unknown;
  to_account_id?: unknown;
  category_id?: unknown;
  description?: unknown;
  occurred_at?: unknown;
  tags?: unknown;
  installments_total?: unknown;
  first_installment_month?: unknown;
  third_party_name?: unknown;
  shared_third_party_amount?: unknown;
}

export interface RawParsedIntent {
  intent?: unknown;
  reply_text?: unknown;
  transactions?: RawParsedTransaction[];
}

export function sanitizeParsedIntent(
  parsed: RawParsedIntent,
  params: {
    accounts: Pick<AccountWithBalance, 'id' | 'type'>[];
    categories: Pick<Category, 'id'>[];
    today: string;
  }
): ParsedIntent {
  const accountMap = new Map(params.accounts.map((a) => [a.id, a]));
  const validCategoryIds = new Set(params.categories.map((c) => c.id));

  const sanitized: ParsedTransactionDraft[] = (Array.isArray(parsed.transactions) ? parsed.transactions : [])
    .filter((tx) => typeof tx.amount === 'number' && Number.isFinite(tx.amount) && tx.amount > 0)
    .map((tx) => {
      const amount = Math.round((tx.amount as number) * 100) / 100;
      const rawType = typeof tx.type === 'string' ? (tx.type as TransactionType) : 'expense';
      const type: TransactionType = PARSABLE_TYPES.has(rawType) ? rawType : 'expense';
      const currency = tx.currency === 'USD' ? 'USD' : 'ARS';

      let account_id =
        typeof tx.account_id === 'string' && accountMap.has(tx.account_id) ? tx.account_id : 'mp';

      if (currency === 'USD' && account_id === 'bbva_credito' && accountMap.has('bbva_credito_usd')) {
        account_id = 'bbva_credito_usd';
      }

      let to_account_id: string | null = null;
      if (type === 'transfer') {
        const candidate = typeof tx.to_account_id === 'string' ? tx.to_account_id : '';
        to_account_id = candidate && accountMap.has(candidate) ? candidate : 'mp_reservas';
        if (to_account_id === account_id) {
          to_account_id = account_id === 'mp' ? 'mp_reservas' : 'mp';
        }
      }

      let category_id: string | null = null;
      if (type === 'expense' || type === 'income') {
        const fallbackCat = type === 'income' ? 'otros_ingresos' : 'otros';
        const candidateCat = typeof tx.category_id === 'string' ? tx.category_id : '';
        category_id = candidateCat && validCategoryIds.has(candidateCat) ? candidateCat : fallbackCat;
      }

      const occurred_at =
        typeof tx.occurred_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tx.occurred_at)
          ? tx.occurred_at
          : params.today;

      const tags = Array.isArray(tx.tags)
        ? Array.from(new Set(tx.tags.map((t) => slugifyTag(String(t))).filter(Boolean)))
        : [];

      const rawInst = tx.installments_total;
      const installments_total =
        typeof rawInst === 'number' && Number.isFinite(rawInst) && Math.trunc(rawInst) >= 2
          ? Math.trunc(rawInst)
          : null;

      let first_installment_month: string | null = null;
      if (installments_total !== null) {
        if (
          typeof tx.first_installment_month === 'string' &&
          /^\d{4}-\d{2}$/.test(tx.first_installment_month)
        ) {
          first_installment_month = tx.first_installment_month;
        } else {
          const isCard = accountMap.get(account_id)?.type === 'credit_card';
          first_installment_month = isCard
            ? addMonths(occurred_at.slice(0, 7), 1)
            : occurred_at.slice(0, 7);
        }
      }

      const third_party_name =
        typeof tx.third_party_name === 'string' && tx.third_party_name.trim()
          ? tx.third_party_name.trim().slice(0, 60)
          : null;

      const rawShared = tx.shared_third_party_amount;
      const shared_third_party_amount =
        type === 'expense' &&
        third_party_name &&
        typeof rawShared === 'number' &&
        Number.isFinite(rawShared) &&
        rawShared > 0 &&
        rawShared < amount
          ? Math.round(rawShared * 100) / 100
          : null;

      return {
        type,
        amount,
        currency,
        account_id,
        to_account_id,
        category_id,
        description:
          (typeof tx.description === 'string' ? tx.description : 'Movimiento').trim().slice(0, 140) ||
          'Movimiento',
        occurred_at,
        tags,
        installments_total,
        first_installment_month,
        third_party_name,
        shared_third_party_amount,
      };
    });

  const intent =
    parsed.intent === 'record' || parsed.intent === 'query' || parsed.intent === 'unknown'
      ? parsed.intent
      : 'unknown';

  return {
    intent,
    reply_text: typeof parsed.reply_text === 'string' ? parsed.reply_text : undefined,
    transactions: sanitized,
  };
}

interface ParseInput {
  text?: string;
  media?: { base64: string; mimeType: string; kind: 'audio' | 'image' };
  accounts: AccountWithBalance[];
  categories: Category[];
  tags: Tag[];
  today: string;
}

export async function parseMessageWithGemini(env: Env, params: ParseInput): Promise<ParsedIntent> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const accountList = params.accounts.map((a) => `- ${a.id}: ${a.name} (${a.type}, ${a.currency})`).join('\n');
  const categoryList = params.categories.map((c) => `- ${c.id}: ${c.name} (${c.type})`).join('\n');
  const tagList = params.tags.map((t) => `#${t.id}`).join(', ');
  const nextMonth = addMonths(params.today.slice(0, 7), 1);

  const systemInstruction = `Sos el asistente financiero personal del usuario en Argentina (español rioplatense).
Interpretá mensajes de texto, notas de voz o fotos de tickets/comprobantes para extraer movimientos financieros o detectar consultas.

Fecha de hoy (America/Argentina/Buenos_Aires): ${params.today}

CUENTAS DISPONIBLES (usar exactamente estos IDs):
${accountList}

CATEGORÍAS DISPONIBLES (usar exactamente estos IDs solo para expense o income):
${categoryList}

ETIQUETAS DISPONIBLES (sin el #, ej. "hormiga"): ${tagList}

REGLAS CLAVE DEL FLUJO DEL USUARIO:
1. Cuenta por defecto si no aclara: "mp" (Mercado Pago).
2. "efectivo" / "cash" / "plata en mano" -> account_id: "efectivo".
3. "tarjeta" / "crédito" / "bbva" / "visa" / "master" -> "bbva_credito" (si es en USD -> "bbva_credito_usd", currency: "USD").
4. "tc mp" / "tarjeta mercado pago" / "tarjeta mp" -> "mp_credito".
5. Reservas: "pasé a reservas" -> type: "transfer", "mp" -> "mp_reservas". "saqué de reservas" -> "mp_reservas" -> "mp".
6. Pago de resumen tarjeta: "pagué la tarjeta" / "pagué BBVA" -> type: "transfer", "mp" -> "bbva_credito" (o "mp_credito" si aclara MP).
7. Categorías clave (separación estricta):
   - "supermercado": compras de casa (super, chino, carnicería, verdulería, huevos).
   - "comida_afuera": almuerzos, delivery, pizza, empanadas, hamburguesas, restaurantes.
   - "kiosco_cafe": alfajores, gaseosas, agua, café, facturas, helado.
   - "servicios": gastos fijos de la casa (luz, agua, gas, internet/wifi, expensas).
   - "suscripciones": apps/servicios personales (YouTube, Spotify, Google AI, Nivel 6, GamePass, Tuenti).
   - "deporte": alquiler de cancha, partido, gimnasio.
8. Etiquetas (tags):
   - Agregá "casa" si menciona casa/hogar/carnicería/verdulería familiar.
   - Agregá "hormiga" si menciona hormiga o es un gusto/snack chico evitable.
   - Agregá "abril" si menciona a Abril.
   - Agregá "familia" si menciona familia/mamá/papá/hermanos.
   - Agregá "vacaciones" o "emergencia" o "hw" (hardware/PC/SSD) si aplica.
9. Inversiones ("BTC", "SPY", "CEDEAR", "USD MEP", "USDT", "invertí"):
   - type: "investment", category_id: null, account_id: "mp" (salvo que aclare otra).
10. Cuotas en tarjeta:
   - Si dice "en X cuotas" o "Xxmonto" -> installments_total = X, first_installment_month = "${nextMonth}" (si no aclara mes).
   - amount SIEMPRE es el monto TOTAL de la compra, nunca el valor de 1 sola cuota.
11. Compras compartidas y gastos de terceros:
   - Si paga algo 100% para otro (ej. "pagué 109k para Carlos") -> type: "third_party", third_party_name: "Carlos", category_id: null.
   - Si es compra COMPARTIDA (ej. "regalo 44000 en 3 cuotas BBVA mitad de Jere") -> type: "expense", amount: 44000 (total), shared_third_party_amount: 22000 (la parte del otro), third_party_name: "Jere", category_id: "regalos".
   - Si alguien le transfiere/devuelve plata de un gasto previo (ej. "Jere me transfirió 22000 por el regalo") -> type: "third_party_repayment", third_party_name: "Jere", account_id: "mp", category_id: null.
12. Abreviaturas argentinas: "k" o "lucas" = x1000, "palo" = 1000000.
13. Si hace una pregunta sobre sus finanzas -> intent: "query", transactions: [].
14. Devolvé descripciones cortas y claras.`;

  const inputContent: Array<Record<string, unknown>> = [];
  if (params.text) {
    inputContent.push({ type: 'text', text: params.text });
  } else if (params.media?.kind === 'audio') {
    inputContent.push({
      type: 'text',
      text: 'Escuchá este audio del usuario y extraé los movimientos financieros o su consulta.',
    });
  } else if (params.media?.kind === 'image') {
    inputContent.push({
      type: 'text',
      text: 'Analizá este ticket o comprobante y extraé el gasto, ingreso o transferencia.',
    });
  }

  if (params.media) {
    inputContent.push({
      type: params.media.kind,
      data: params.media.base64,
      mime_type: params.media.mimeType,
    });
  }

  const interaction = await ai.interactions.create({
    model: GEMINI_MODEL,
    store: false,
    generation_config: { thinking_level: 'minimal' },
    system_instruction: systemInstruction,
    input: inputContent as never,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: PARSE_SCHEMA,
    },
  });

  const rawText = interaction.output_text ?? '{}';
  let parsed: RawParsedIntent;
  try {
    parsed = JSON.parse(rawText) as RawParsedIntent;
  } catch {
    return { intent: 'unknown', reply_text: 'No pude interpretar la respuesta de la IA.', transactions: [] };
  }

  return sanitizeParsedIntent(parsed, {
    accounts: params.accounts,
    categories: params.categories,
    today: params.today,
  });
}

export async function answerFinancialQuery(
  env: Env,
  params: {
    question: string;
    summary: MonthSummary;
    recentTransactions: Transaction[];
    accounts: AccountWithBalance[];
    projection?: FutureProjection;
  }
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const balancesStr = params.accounts
    .map((a) => `- ${a.name}: ${formatCurrency(a.balance, a.currency)}`)
    .join('\n');
  const catsStr = params.summary.by_category
    .map((c) => `- ${c.icon} ${c.name}: ${formatCurrency(c.total)} (${c.percentage}%)`)
    .join('\n');
  const tagsStr = params.summary.by_tag
    .map((t) => `- #${t.name}: ${formatCurrency(t.total)} (${t.percentage}%)`)
    .join('\n');
  const tpStr = params.summary.third_party_by_person
    .map((p) => `- ${p.person}: ${formatCurrency(p.pending)}`)
    .join('\n');
  const txStr = params.recentTransactions
    .slice(0, 25)
    .map((t) => {
      const tagSuffix = t.tags.length > 0 ? ` [${t.tags.map((x) => `#${x}`).join(' ')}]` : '';
      return `- ${t.occurred_at} | ${t.type} | ${formatCurrency(t.amount, t.currency)} | ${t.description} (${t.account_id})${tagSuffix}`;
    })
    .join('\n');

  const nextMonthProj = params.projection?.months[0];
  const projStr = nextMonthProj
    ? `\nProyección próximo mes (${nextMonthProj.month}):
- Cuotas de tarjeta: ${formatCurrency(nextMonthProj.installments_total_amount)}
- Gastos fijos mensuales: ${formatCurrency(nextMonthProj.recurring_total_amount)}
- Total comprometido: ${formatCurrency(nextMonthProj.total_committed)}
- Saldo en MP Reservas: ${formatCurrency(params.projection?.reservas_balance ?? 0)}
- Diferencia reservas vs comprometido: ${formatCurrency(params.projection?.next_month_coverage_delta ?? 0)}`
    : '';

  const prompt = `Pregunta del usuario: "${params.question}"

Datos reales del mes ${params.summary.month}:
- Ingresos totales: ${formatCurrency(params.summary.income)}
- Gastos de consumo: ${formatCurrency(params.summary.expense)}
- Invertido del mes: ${formatCurrency(params.summary.investment)}
- Balance neto (Ingresos - Gastos): ${formatCurrency(params.summary.net)}
- Gastos USD del mes: ${formatCurrency(params.summary.usd_expense, 'USD')}

Saldos de cuentas:
${balancesStr}

Gastos por categoría este mes:
${catsStr || '(Sin gastos este mes)'}

Gastos por etiqueta este mes:
${tagsStr || '(Sin etiquetas este mes)'}

Pendiente de terceros (te deben):
${tpStr || '(Nada pendiente)'}
${projStr}

Últimos movimientos del mes:
${txStr || '(Sin movimientos)'}`;

  const interaction = await ai.interactions.create({
    model: GEMINI_MODEL,
    store: false,
    generation_config: { thinking_level: 'minimal' },
    system_instruction:
      'Respondé en español argentino, de forma clara, directa y concisa (máximo 8 líneas), usando únicamente los datos provistos.',
    input: prompt,
  });

  return interaction.output_text?.trim() || 'No encontré información suficiente para responder.';
}
