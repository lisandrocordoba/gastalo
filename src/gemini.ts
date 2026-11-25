import { GoogleGenAI } from '@google/genai';
import type {
  AccountWithBalance,
  Category,
  Env,
  MonthSummary,
  ParsedIntent,
  ParsedTransactionDraft,
  Transaction,
} from './types';
import { formatCurrency } from './utils';

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
          type: { type: 'string', enum: ['expense', 'income', 'transfer'] },
          amount: { type: 'number' },
          currency: { type: 'string', enum: ['ARS', 'USD'] },
          account_id: { type: 'string' },
          to_account_id: { type: ['string', 'null'] },
          category_id: { type: ['string', 'null'] },
          description: { type: 'string' },
          occurred_at: { type: 'string', description: 'Fecha YYYY-MM-DD' },
        },
        required: ['type', 'amount', 'currency', 'account_id', 'description', 'occurred_at'],
      },
    },
  },
  required: ['intent', 'transactions'],
};

interface ParseInput {
  text?: string;
  media?: { base64: string; mimeType: string; kind: 'audio' | 'image' };
  accounts: AccountWithBalance[];
  categories: Category[];
  today: string;
}

export async function parseMessageWithGemini(env: Env, params: ParseInput): Promise<ParsedIntent> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const accountList = params.accounts.map((a) => `- ${a.id}: ${a.name} (${a.type}, ${a.currency})`).join('\n');
  const categoryList = params.categories.map((c) => `- ${c.id}: ${c.name} (${c.type})`).join('\n');

  const systemInstruction = `Sos el asistente financiero personal del usuario en Argentina (español rioplatense).
Tu tarea es interpretar mensajes de texto, notas de voz o fotos de tickets/comprobantes para extraer movimientos financieros o detectar si hace una pregunta sobre sus finanzas.

Fecha de hoy (America/Argentina/Buenos_Aires): ${params.today}

CUENTAS DISPONIBLES (usar exactamente estos IDs):
${accountList}

CATEGORÍAS DISPONIBLES (usar exactamente estos IDs):
${categoryList}

REGLAS CLAVE DEL FLUJO DEL USUARIO:
1. Si NO aclara con qué pagó o dónde entró, la cuenta por defecto es "mp" (Mercado Pago).
2. Si menciona "efectivo", "cash" o "plata en mano" -> account_id: "efectivo".
3. Si menciona "tarjeta", "crédito", "bbva", "visa", "master" o "cuotas" -> account_id: "bbva_credito".
4. Si dice que pasó plata a "reservas" o guardó en reservas -> type: "transfer", account_id: "mp", to_account_id: "mp_reservas", category_id: null.
5. Si dice que sacó plata de "reservas" -> type: "transfer", account_id: "mp_reservas", to_account_id: "mp", category_id: null.
6. Si dice que "pagó la tarjeta", "pagó BBVA" o "pagó el resumen" -> type: "transfer", account_id: "mp", to_account_id: "bbva_credito", category_id: null.
7. Si cobró sueldo en BBVA y lo pasó a Mercado Pago, podés registrar el income en "mp" o el par según lo que diga; si solo dice "cobré X", registrá income en "mp" con categoría "sueldo".
8. Interpretá abreviaturas argentinas: "k" o "lucas" = x1000 (ej. "45k" = 45000), "palo" = 1000000.
9. Si envía una foto de ticket o captura de pago, leé el comercio, el monto total real y la fecha si está visible (si no es clara o es antigua sin contexto, usá ${params.today}).
10. Si hace una pregunta sobre cuánto gastó, saldos, etc. -> intent: "query", transactions: [].
11. Puede haber múltiples transacciones en un mismo audio o texto; devolvé todas en transactions[].
12. Devolvé descripciones cortas y claras (ej. "Café Martínez", "Supermercado Coto", "Pago resumen BBVA").`;

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
  let parsed: ParsedIntent;
  try {
    parsed = JSON.parse(rawText) as ParsedIntent;
  } catch {
    return { intent: 'unknown', reply_text: 'No pude interpretar la respuesta de la IA.', transactions: [] };
  }

  const validAccountIds = new Set(params.accounts.map((a) => a.id));
  const validCategoryIds = new Set(params.categories.map((c) => c.id));

  const sanitized: ParsedTransactionDraft[] = (parsed.transactions ?? [])
    .filter((tx) => typeof tx.amount === 'number' && tx.amount > 0)
    .map((tx) => {
      const type = tx.type === 'income' || tx.type === 'transfer' ? tx.type : 'expense';
      const account_id = validAccountIds.has(tx.account_id) ? tx.account_id : 'mp';
      let to_account_id: string | null = null;
      if (type === 'transfer') {
        to_account_id = tx.to_account_id && validAccountIds.has(tx.to_account_id) ? tx.to_account_id : 'mp_reservas';
        if (to_account_id === account_id) {
          to_account_id = account_id === 'mp' ? 'mp_reservas' : 'mp';
        }
      }

      let category_id: string | null = null;
      if (type !== 'transfer') {
        const fallbackCat = type === 'income' ? 'otros_ingresos' : 'otros';
        category_id = tx.category_id && validCategoryIds.has(tx.category_id) ? tx.category_id : fallbackCat;
      }

      const occurred_at = /^\d{4}-\d{2}-\d{2}$/.test(tx.occurred_at) ? tx.occurred_at : params.today;
      return {
        type,
        amount: Math.round(tx.amount * 100) / 100,
        currency: tx.currency === 'USD' ? 'USD' : 'ARS',
        account_id,
        to_account_id,
        category_id,
        description: (tx.description || 'Movimiento').trim().slice(0, 140),
        occurred_at,
      };
    });

  return {
    intent: parsed.intent ?? 'unknown',
    reply_text: parsed.reply_text,
    transactions: sanitized,
  };
}

export async function answerFinancialQuery(
  env: Env,
  params: {
    question: string;
    summary: MonthSummary;
    recentTransactions: Transaction[];
    accounts: AccountWithBalance[];
  }
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const balancesStr = params.accounts
    .map((a) => `- ${a.name}: ${formatCurrency(a.balance, a.currency)}`)
    .join('\n');
  const catsStr = params.summary.by_category
    .map((c) => `- ${c.icon} ${c.name}: ${formatCurrency(c.total)} (${c.percentage}%)`)
    .join('\n');
  const txStr = params.recentTransactions
    .slice(0, 25)
    .map((t) => `- ${t.occurred_at} | ${t.type} | ${formatCurrency(t.amount, t.currency)} | ${t.description} (${t.account_id})`)
    .join('\n');

  const prompt = `Pregunta del usuario: "${params.question}"

Datos reales del mes ${params.summary.month}:
- Ingresos totales: ${formatCurrency(params.summary.income)}
- Gastos totales: ${formatCurrency(params.summary.expense)}
- Balance neto del mes: ${formatCurrency(params.summary.net)}

Saldos de cuentas:
${balancesStr}

Gastos por categoría este mes:
${catsStr || '(Sin gastos este mes)'}

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
