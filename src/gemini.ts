import { GoogleGenAI } from '@google/genai';
import { pickDefaultLiquidAccount } from './db';
import type {
  AccountType,
  AccountWithBalance,
  Category,
  CategoryType,
  Env,
  FutureProjection,
  ManageOperation,
  MonthSummary,
  ParsedIntent,
  ParsedTransactionDraft,
  Tag,
  Transaction,
  TransactionType,
} from './types';
import { addMonths, defaultColorForAccountType, formatCurrency, slugifyTag } from './utils';

const GEMINI_MODEL = 'gemini-3.5-flash-lite';

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['record', 'query', 'manage', 'unknown'],
      description:
        'record si reporta movimientos, query si pregunta finanzas, manage si pide crear cuentas/tarjetas/categorias/etiquetas, unknown si no se entiende',
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
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create_account', 'create_category', 'create_tag'],
          },
          name: { type: 'string' },
          account_type: {
            type: ['string', 'null'],
            enum: ['wallet', 'savings', 'credit_card', 'cash', null],
          },
          currency: { type: ['string', 'null'] },
          initial_balance: { type: ['number', 'null'] },
          is_default: { type: ['boolean', 'null'] },
          icon: { type: ['string', 'null'] },
          category_type: {
            type: ['string', 'null'],
            enum: ['expense', 'income', 'both', null],
          },
          color: { type: ['string', 'null'] },
        },
        required: ['action', 'name'],
      },
    },
  },
  required: ['intent', 'transactions', 'operations'],
};

const PARSABLE_TYPES = new Set<TransactionType>([
  'expense',
  'income',
  'transfer',
  'investment',
  'third_party',
  'third_party_repayment',
]);

const VALID_ACCOUNT_TYPES = new Set<AccountType>(['wallet', 'savings', 'credit_card', 'cash']);

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

interface RawManageOperation {
  action?: unknown;
  name?: unknown;
  account_type?: unknown;
  currency?: unknown;
  initial_balance?: unknown;
  is_default?: unknown;
  icon?: unknown;
  category_type?: unknown;
  color?: unknown;
}

export interface RawParsedIntent {
  intent?: unknown;
  reply_text?: unknown;
  transactions?: RawParsedTransaction[];
  operations?: RawManageOperation[];
}

export function sanitizeParsedIntent(
  parsed: RawParsedIntent,
  params: {
    accounts: Pick<AccountWithBalance, 'id' | 'type' | 'currency' | 'is_default'>[];
    categories: (Pick<Category, 'id'> & { type?: CategoryType })[];
    today: string;
    defaultCurrency?: string;
  }
): ParsedIntent {
  const defaultCurrency = (params.defaultCurrency || 'ARS').trim().toUpperCase() || 'ARS';
  const accountMap = new Map(params.accounts.map((a) => [a.id, a]));
  const validCategoryIds = new Set(params.categories.map((c) => c.id));

  const operations: ManageOperation[] = [];
  if (Array.isArray(parsed.operations)) {
    for (const rawOp of parsed.operations) {
      const cleanName = typeof rawOp.name === 'string' ? rawOp.name.trim().slice(0, 60) : '';
      if (!cleanName) continue;

      if (rawOp.action === 'create_account') {
        const rawAccType =
          typeof rawOp.account_type === 'string' ? (rawOp.account_type as AccountType) : 'wallet';
        const account_type: AccountType = VALID_ACCOUNT_TYPES.has(rawAccType)
          ? rawAccType
          : 'wallet';
        const currency =
          typeof rawOp.currency === 'string' && rawOp.currency.trim()
            ? rawOp.currency.trim().toUpperCase().slice(0, 6)
            : defaultCurrency;
        const initial_balance =
          typeof rawOp.initial_balance === 'number' && Number.isFinite(rawOp.initial_balance)
            ? Math.round(rawOp.initial_balance * 100) / 100
            : 0;
        const is_default = account_type === 'credit_card' ? false : Boolean(rawOp.is_default);
        operations.push({
          action: 'create_account',
          name: cleanName,
          account_type,
          currency,
          initial_balance,
          is_default,
        });
      } else if (rawOp.action === 'create_category') {
        const category_type: CategoryType =
          rawOp.category_type === 'income' || rawOp.category_type === 'both'
            ? rawOp.category_type
            : 'expense';
        const icon =
          typeof rawOp.icon === 'string' && rawOp.icon.trim() ? rawOp.icon.trim().slice(0, 8) : '📦';
        const color =
          typeof rawOp.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(rawOp.color.trim())
            ? rawOp.color.trim()
            : '#9E9E9E';
        operations.push({
          action: 'create_category',
          name: cleanName,
          icon,
          category_type,
          color,
        });
      } else if (rawOp.action === 'create_tag') {
        const slug = slugifyTag(cleanName);
        if (!slug) continue;
        const color =
          typeof rawOp.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(rawOp.color.trim())
            ? rawOp.color.trim()
            : '#71717a';
        operations.push({
          action: 'create_tag',
          name: cleanName.replace(/^#/, ''),
          color,
        });
      }
    }
  }

  const sanitized: ParsedTransactionDraft[] =
    params.accounts.length === 0
      ? []
      : (Array.isArray(parsed.transactions) ? parsed.transactions : [])
          .filter((tx) => typeof tx.amount === 'number' && Number.isFinite(tx.amount) && tx.amount > 0)
          .map((tx) => {
            const amount = Math.round((tx.amount as number) * 100) / 100;
            const rawType = typeof tx.type === 'string' ? (tx.type as TransactionType) : 'expense';
            const type: TransactionType = PARSABLE_TYPES.has(rawType) ? rawType : 'expense';
            const currency = tx.currency === 'USD' ? 'USD' : defaultCurrency;

            const defaultAccount =
              pickDefaultLiquidAccount(params.accounts, currency) ?? params.accounts[0];
            let account_id =
              typeof tx.account_id === 'string' && accountMap.has(tx.account_id)
                ? tx.account_id
                : defaultAccount.id;

            const chosenAcc = accountMap.get(account_id);
            if (chosenAcc && chosenAcc.currency !== currency) {
              const sameTypeCurrencyMatch = params.accounts.find(
                (a) => a.type === chosenAcc.type && a.currency === currency
              );
              if (sameTypeCurrencyMatch) {
                account_id = sameTypeCurrencyMatch.id;
              }
            }

            let to_account_id: string | null = null;
            if (type === 'transfer') {
              const candidate = typeof tx.to_account_id === 'string' ? tx.to_account_id : '';
              if (candidate && candidate !== account_id && accountMap.has(candidate)) {
                to_account_id = candidate;
              } else {
                const savingsAcc = params.accounts.find(
                  (a) => a.type === 'savings' && a.id !== account_id
                );
                const otherAcc = params.accounts.find((a) => a.id !== account_id);
                to_account_id = savingsAcc?.id ?? otherAcc?.id ?? null;
              }
            }

            let category_id: string | null = null;
            if (type === 'expense' || type === 'income') {
              const candidateCat = typeof tx.category_id === 'string' ? tx.category_id : '';
              if (candidateCat && validCategoryIds.has(candidateCat)) {
                category_id = candidateCat;
              } else {
                const preferredFallback = type === 'income' ? 'otros_ingresos' : 'otros';
                if (validCategoryIds.has(preferredFallback)) {
                  category_id = preferredFallback;
                } else {
                  const firstMatching = params.categories.find(
                    (c) => !c.type || c.type === type || c.type === 'both'
                  );
                  category_id = firstMatching?.id ?? params.categories[0]?.id ?? null;
                }
              }
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
                (typeof tx.description === 'string' ? tx.description : 'Movimiento')
                  .trim()
                  .slice(0, 140) || 'Movimiento',
              occurred_at,
              tags,
              installments_total,
              first_installment_month,
              third_party_name,
              shared_third_party_amount,
            };
          });

  const intent =
    parsed.intent === 'record' ||
    parsed.intent === 'query' ||
    parsed.intent === 'manage' ||
    parsed.intent === 'unknown'
      ? parsed.intent
      : 'unknown';

  return {
    intent,
    reply_text: typeof parsed.reply_text === 'string' ? parsed.reply_text : undefined,
    transactions: sanitized,
    operations,
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
  const defaultCurrency = env.DEFAULT_CURRENCY || 'ARS';

  const accountList =
    params.accounts.length > 0
      ? params.accounts
          .map(
            (a) =>
              `- ${a.id}: ${a.name} (${a.type}, ${a.currency}${a.is_default ? ', PRINCIPAL' : ''})`
          )
          .join('\n')
      : '(Todavía no hay cuentas creadas)';

  const categoryList =
    params.categories.length > 0
      ? params.categories.map((c) => `- ${c.id}: ${c.name} (${c.type})`).join('\n')
      : '(Sin categorías)';

  const tagList = params.tags.length > 0 ? params.tags.map((t) => `#${t.id}`).join(', ') : '(Sin etiquetas)';
  const nextMonth = addMonths(params.today.slice(0, 7), 1);

  const emptyAccountsRule =
    params.accounts.length === 0
      ? '\nATENCIÓN: El usuario todavía no creó cuentas. Si pide registrar un gasto o ingreso antes de tener cuentas, devolvé intent: "unknown" con reply_text explicándole amablemente que primero cree su primera cuenta (por ejemplo: "Creá mi cuenta principal en ARS").'
      : '';

  const systemInstruction = `Sos el asistente financiero personal del usuario (español rioplatense).
Interpretá mensajes de texto, notas de voz o fotos de tickets/comprobantes para:
- Registrar movimientos financieros (intent: "record")
- Responder consultas financieras (intent: "query")
- Crear cuentas, tarjetas de crédito, categorías o etiquetas (intent: "manage")

Fecha de hoy (${env.TIMEZONE || 'America/Argentina/Buenos_Aires'}): ${params.today}
Moneda por defecto: ${defaultCurrency}

CUENTAS DISPONIBLES (usar exactamente estos IDs):
${accountList}

CATEGORÍAS DISPONIBLES (usar exactamente estos IDs solo para expense o income):
${categoryList}

ETIQUETAS DISPONIBLES (devolver sin el #, ej. "hormiga"): ${tagList}
${emptyAccountsRule}

REGLAS PARA MOVIMIENTOS (intent: "record"):
1. Cuenta por defecto: elegí la cuenta marcada como PRINCIPAL (o la cuenta líquida cuyo nombre/tipo mejor coincida con lo mencionado en el mensaje).
2. Si menciona pagar en dólares / USD y existe una cuenta o tarjeta en moneda USD compatible, elegí esa cuenta y currency: "USD".
3. Transferencias internas entre cuentas propias (ej. mover dinero hacia ahorros/reservas o pagar el resumen de una tarjeta desde una cuenta líquida): type: "transfer", account_id = origen, to_account_id = destino.
4. Separación de categorías de gasto si existen en la lista:
   - Compras de abastecimiento del hogar -> "supermercado"
   - Comidas preparadas / restaurantes / delivery -> "comida_afuera"
   - Snacks chicos / café al paso -> "kiosco_cafe"
   - Servicios fijos del hogar (luz, agua, gas, internet) -> "servicios"
   - Suscripciones y apps personales -> "suscripciones"
5. Etiquetas (tags): aplicá solo etiquetas existentes o nuevas en minúscula cuando el contexto del mensaje lo indique claramente (ej. "casa", "hormiga", "familia", "vacaciones", "emergencia").
6. Inversiones (acciones, bonos, ETFs, criptomonedas, MEP): type: "investment", category_id: null.
7. Cuotas en tarjeta de crédito: si dice "en X cuotas" o "Xxmonto", installments_total = X, first_installment_month = "${nextMonth}" (salvo que aclare otro mes). amount SIEMPRE es el monto TOTAL de la compra.
8. Compras compartidas y terceros:
   - Pago 100% para otra persona -> type: "third_party", third_party_name: nombre de la persona, category_id: null.
   - Compra compartida -> type: "expense", amount = total pagado, shared_third_party_amount = parte de la otra persona, third_party_name = nombre.
   - Devolución de dinero de un tercero -> type: "third_party_repayment", third_party_name = nombre, category_id: null.
9. Abreviaturas comunes: "k" o "lucas" = x1000, "palo" = x1000000.

REGLAS PARA CONFIGURACIÓN (intent: "manage", operations: [...]):
- Usar cuando el usuario pida explícitamente crear/agregar una cuenta, billetera, caja de ahorro/reservas, efectivo, tarjeta de crédito, categoría o etiqueta (ej. "Creá una cuenta Banco Galicia en ARS", "Agregá tarjeta de crédito Visa en dólares", "Creá la categoría Gimnasio", "Agregá la etiqueta #viaje").
- account_type válidas: "wallet" (billetera/banco), "savings" (ahorro/reservas), "cash" (efectivo), "credit_card" (tarjeta de crédito).
- Si aclara saldo inicial ("con saldo inicial 50000"), ponerlo en initial_balance.
- Si pide marcarla como cuenta principal / por defecto, is_default: true (false para tarjetas).

REGLAS GENERALES:
- Si hace una pregunta sobre saldos, gastos, cuotas o resúmenes -> intent: "query", transactions: [], operations: [].
- Devolvé descripciones cortas y claras.`;

  const inputContent: Array<Record<string, unknown>> = [];
  if (params.text) {
    inputContent.push({ type: 'text', text: params.text });
  } else if (params.media?.kind === 'audio') {
    inputContent.push({
      type: 'text',
      text: 'Escuchá este audio del usuario y extraé los movimientos, la configuración solicitada o su consulta.',
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
    return {
      intent: 'unknown',
      reply_text: 'No pude interpretar la respuesta de la IA.',
      transactions: [],
      operations: [],
    };
  }

  return sanitizeParsedIntent(parsed, {
    accounts: params.accounts,
    categories: params.categories,
    today: params.today,
    defaultCurrency,
  });
}

export { defaultColorForAccountType };

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

  const balancesStr =
    params.accounts.length > 0
      ? params.accounts
          .map((a) => `- ${a.name} (${a.type}): ${formatCurrency(a.balance, a.currency)}`)
          .join('\n')
      : '(Sin cuentas creadas todavía)';
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
- Saldo en cuentas de reservas/ahorro: ${formatCurrency(params.projection?.reservas_balance ?? 0)}
- Diferencia reservas vs comprometido: ${formatCurrency(params.projection?.next_month_coverage_delta ?? 0)}`
    : '';

  const prompt = `Pregunta del usuario: "${params.question}"

Datos reales del mes ${params.summary.month}:
- Ingresos totales: ${formatCurrency(params.summary.income)}
- Gastos de consumo (flujo real): ${formatCurrency(params.summary.expense)}
- Compras hechas con TC: ${formatCurrency(params.summary.card_purchases)}
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
      'Respondé en español rioplatense, de forma clara, directa y concisa (máximo 8 líneas), usando únicamente los datos provistos.',
    input: prompt,
  });

  return interaction.output_text?.trim() || 'No encontré información suficiente para responder.';
}
