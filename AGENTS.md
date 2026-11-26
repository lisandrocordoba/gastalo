# AGENTS.md — Guía de Mantenimiento para Agentes (Gasti Personal)

Este documento es el punto de entrada técnico para cualquier agente de desarrollo que mantenga o extienda **Gasti Personal** (aplicación de finanzas personales **v3.1**, evolución endurecida sobre v3.0, 100% agnóstica y serverless sobre Cloudflare Workers + D1).

---

## 1. Resumen y Stack Técnico

- **Backend / Worker:** Cloudflare Workers + **Hono** (`src/`).
- **Base de datos:** Cloudflare **D1** (SQLite administrado, `migrations/`).
- **IA Multimodal (Bot):** Google **Gemini** (`gemini-3.5-flash-lite`) usando el SDK oficial `@google/genai` vía `ai.interactions.create` (`src/gemini.ts`).
- **Bot de Telegram:** Webhook + callbacks inline (`src/telegram.ts`).
- **Frontend (PWA + Telegram Mini App):** **React 19** + **TypeScript** + **Vite 6** + **Tailwind CSS v4** + **Recharts** + **Lucide Icons** (`web/src/`), servido desde el mismo Worker como *Workers Static Assets* (`web/dist`).
- **Tests:** **Vitest** (`test/core.test.ts`).

---

## 2. Mapa del Repositorio

| Ruta | Responsabilidad |
| :--- | :--- |
| [`src/index.ts`](src/index.ts) | Entrypoint Hono: `/webhook/telegram` (carga diferida de `telegram.ts`), `/api/bootstrap` (`loadBootstrapSnapshot`), CRUD `/api/accounts`, `POST /api/accounts/:id/reconcile`, `/api/categories`, `/api/tags`, `/api/recurring`, `/api/transactions`, `POST /api/transactions/shared`, `/api/cards/:id/pay-statement`, `/api/projection`, `/api/export.csv`, `/api/health`. |
| [`src/db.ts`](src/db.ts) | Consultas D1 (`loadBootstrapSnapshot` con pushdown SQL/agregaciones en `db.batch` + `loadAllDataSnapshot`) y funciones puras (`computeAccountBalances`, `computeCardStatements` con `pending`/`partial`/`paid`, `computeOverdueCardAlerts` en 1 pasada `O(N)`, `computePeriodMetrics`, `computeMonthlyHistory`, `computeFutureProjection`, `payCardStatement`, `reconcileAccountBalance`, `createSharedPurchase`, CRUD con `ConflictError` `409`). |
| [`src/gemini.ts`](src/gemini.ts) | Esquema JSON estricto (`PARSE_SCHEMA`), sanitización (`sanitizeParsedIntent`), parser multimodal (`record` / `query` con `query_month` / `manage` incl. `create_recurring` / `unsupported` / `unknown`) acotado a `ARS`/`USD`/`BRL`, transferencias multimoneda (`to_amount`), carga diferida de `@google/genai` y respuestas (`answerFinancialQuery`). |
| [`src/telegram.ts`](src/telegram.ts) | Comandos (`/start`, `/ayuda`, `/help`, `/cuentas`, `/config`, `/fijos`, `/suscripciones`, `/saldos`, `/resumen [YYYY-MM]`, `/mes`, `/futuro`, `/ultimos`), botones inline (`ok`, `catm`, `cat`, `accm`, `acc`, `tagm`, `tagt`/`tagi`, `back`, `resv`, `del`, `delacc`, `delcat`, `deltag`, `delrec`), verificación *fail-closed* de usuario/chat privado y manejo de texto/audio/foto. |
| [`src/auth.ts`](src/auth.ts) | Validación *fail-closed* en tiempo constante vía SHA-256 de `DASHBOARD_TOKEN` (`Bearer`) y verificación criptográfica HMAC-SHA256 de Telegram `initData` (`auth_date` obligatorio <= 24h y `ALLOWED_TELEGRAM_USER_ID`). |
| [`src/types.ts`](src/types.ts) | Contratos TypeScript compartidos de backend (`SUPPORTED_CURRENCIES = ['ARS', 'USD', 'BRL']`, `PaidStatementItem`, `CardStatement`, etc.). |
| [`src/utils.ts`](src/utils.ts) | Helpers de zona horaria (`todayInTimezone`, `currentMonthInTimezone`), meses (`addMonths`, `monthDiff`, `previousMonths`), IDs y formato `ARS`/`USD`/`BRL` (`$`, `US$`, `R$`). |
| [`migrations/0001_initial.sql`](migrations/0001_initial.sql) | Esquema limpio v3 ya aplicado en producción (`0` cuentas iniciales, `22` categorías base, `5` etiquetas base). |
| [`migrations/0002_indexes.sql`](migrations/0002_indexes.sql) | Índices adicionales en `transactions(to_account_id)`, `recurring_items(account_id)` y `transactions(telegram_message_id)` para deduplicación de webhook. |
| [`migrations/0003_cards_closing_and_fx.sql`](migrations/0003_cards_closing_and_fx.sql) | Agrega `accounts.closing_day` (cierre de tarjeta `1–31`) y `transactions.to_amount` (monto acreditado en transferencias/pagos multimoneda). |
| [`web/src/App.tsx`](web/src/App.tsx) | Orquestador de estado del Dashboard, filtros (con atribución vía `paid_statement_items` y `referencedTransactions`) y montaje único de modales. |
| [`web/src/api.ts`](web/src/api.ts) | Cliente HTTP hacia `/api/*` y formateo monetario (`formatMoney`). |
| [`web/src/components/`](web/src/components/) | `SummaryCards`, `CurrentStatusBar`, `AccountsGrid`, `CreditCardsSection`, `CategoryChart`, `MonthlyChart`, `TagsPanel`, `FutureProjectionCard`, `TransactionList`, `AccountModal`, `RecurringModal`, `TransactionModal`, `SettingsModal`, `DateRangePicker`. |
| [`test/core.test.ts`](test/core.test.ts) | Tests unitarios de lógica contable, cuotas, `budget_month`, `start_month`, `due_day`, alertas vencidas, pagos parciales, auth *fail-closed* y `sanitizeParsedIntent`. |
| [`docs/`](docs/) | [`ARQUITECTURA.md`](docs/ARQUITECTURA.md), [`MODELO_DATOS.md`](docs/MODELO_DATOS.md), [`TELEGRAM_BOT.md`](docs/TELEGRAM_BOT.md), [`PLAN_V3_AGNOSTICO.md`](docs/PLAN_V3_AGNOSTICO.md) y [`ROADMAP.md`](docs/ROADMAP.md). |
| `wrangler.example.toml` / `.dev.vars.example` | Plantillas públicas para levantar instancias limpias sin secretos ni IDs propios. |
| `wrangler.toml`, `imports/`, `.dev.vars`, `.wrangler/`, `.agent/` | **Ignorados en `.gitignore`.** Contienen configuración personal de despliegue (`database_id`, `DASHBOARD_URL`), datos personales del usuario (CSV, migrador local), secretos y estado D1 local. **Nunca** trackear ni subir a Git. |

---

## 3. Invariantes Críticas de Dominio (No Romper)

1. **Repositorio 100% agnóstico:**
   - **Prohibido** hardcodear nombres propios, bancos, tarjetas personales, personas reales o IDs fijos (`'mp'`, `'bbva'`, `'abril'`, etc.) en código, migraciones, tests o docs.
   - Resolver cuentas por capacidades (`is_default = 1`, `type IN ('wallet','savings','cash','credit_card')`, `currency` en `ARS`, `USD` o `BRL`).
   - `wrangler.toml` se mantiene fuera de Git (listado en `.gitignore`); solo se versiona `wrangler.example.toml`.

2. **Contabilidad de tarjetas (`expense` vs. `transfer` con `statement_month` y pagos multimoneda):**
   - Los `expense` y `third_party` en una `credit_card` descuentan el saldo de la tarjeta al instante (deuda negativa), pero **no** suman en consumo `cash` del período al pasar la tarjeta.
   - El gasto entra en consumo real recién cuando se paga el resumen mediante `transfer` con `to_account_id = card.id` y `statement_month` (`YYYY-MM`), con asignación cronológica acumulada para pagos parciales/múltiples (`status: 'pending' | 'partial' | 'paid'`), prorrateando solo la porción propia (`own_total`) por categoría y etiqueta, y exponiendo `paid_statement_items` + `referencedTransactions` en `/api/bootstrap`.
   - **Transferencias y pagos entre monedas distintas (`to_amount` / `source_amount`):** cuando `transfer` conecta cuentas de distinta moneda (`account.currency !== to_account.currency`), `amount` se debita en la moneda origen y `to_amount` se acredita en la moneda destino. Al pagar un resumen de tarjeta en moneda extranjera desde otra moneda (`POST /api/cards/:id/pay-statement` con `source_amount`), el egreso real en flujo `cash` se imputa en la moneda origen (`source_amount`, equivalente a `to_amount` en la tarjeta) sin doble contabilización.
   - `third_party` y `third_party_repayment` nunca suman al consumo personal ni a ingresos.

3. **Semántica de fechas, cierres y vencimientos:**
   - `occurred_at` (`YYYY-MM-DD`): fecha real bancaria; **siempre** manda en saldos actuales.
   - `budget_month` (`YYYY-MM`, opcional): permite imputar ingresos de fin de mes al mes siguiente en KPIs, gráficos y listados (`effectiveTransactionDate`), sin alterar saldos.
   - `recurring_items.start_month` (`YYYY-MM`, opcional): en tarjetas marca el *primer resumen*; en proyección futura filtra meses `>= start_month`. `day_of_month` es opcional y solo referencia para fechar el cargo dentro de `statement_month`.
   - `accounts.closing_day` (`1–31`, opcional, solo `credit_card`): define el resumen por defecto de nuevas compras con tarjeta (`day <= clamp(closing_day)` → `mes + 1`; `day > clamp(closing_day)` → `mes + 2`, haciendo clamp a la longitud real del mes). Si es `null`, cae a `mes + 1`.
   - `accounts.due_day` (`1–31`, opcional, solo `credit_card`): `computeCardStatements` calcula `due_date` haciendo clamp al último día del mes y marca `is_overdue: true` solo si `!paid && total_due > 0 && today > due_date`. `computeOverdueCardAlerts` revisa todos los meses candidatos `<= hoy` e incluye `remaining_due` y `status` (`'pending' | 'partial'`) para mantener el banner superior fijo con el saldo impago real.

4. **Fuente única de verdad en UI:**
   - Los modales principales (`AccountModal.tsx`, `RecurringModal.tsx`, `TransactionModal.tsx`) se montan **una sola vez** en `web/src/App.tsx`.
   - Cualquier botón nuevo en distintas secciones (`SettingsModal`, `CreditCardsSection`, `FutureProjectionCard`) debe abrir el modal compartido vía props, sin duplicar formularios embebidos ni estados paralelos.
   - Si se cambia la cuenta de una transacción o gasto fijo (`PATCH /api/recurring/:id` o callback de Telegram), mantener sincronizada `currency`.

5. **Migraciones D1 inmutables:**
   - `migrations/0001_initial.sql`, `migrations/0002_indexes.sql` y las migraciones ya aplicadas en producción son inmutables.
   - Todo cambio futuro de esquema **debe** crearse como un nuevo archivo numerado (`migrations/0004_...sql`, etc.) y probarse primero en `--local`.

6. **SDK de Gemini:**
   - Usar únicamente `@google/genai` con `ai.interactions.create` (`GEMINI_MODEL = 'gemini-3.5-flash-lite'`), nunca APIs legacy.

---

## 4. Decisiones y Evolución de Invariantes (v3.1)

Al auditar **v3.0** contra el comportamiento real del motor contable, los endpoints y la seguridad en producción, se refinaron y cerraron explícitamente cinco invariantes:

1. **Monedas acotadas estrictamente a `ARS`, `USD`, `BRL` (`$`, `US$`, `R$`):**
   - *Por qué:* anteriormente el `README.md`, `docs/MODELO_DATOS.md` y `AccountModal` mencionaban "otras monedas" (`EUR`, `CLP`, `UYU`, `MXN`, etc.), mientras que el motor contable y Gemini solo procesaban `ARS` y `USD`, descartando silenciosamente el resto o mezclando monedas distintas en totales de saldo/proyección.
   - *Decisión:* se acota explícitamente a `ARS`, `USD` y `BRL` con validación en API, DB/lógica contable, Gemini (`SUPPORTED_CURRENCIES`) y UI para garantizar integridad contable real.

2. **Atribución de resúmenes pagados en `TransactionList` (`paid_statement_items`):**
   - *Por qué:* bajo la Opción B (`cash`), pagar un resumen de tarjeta en el mes `M` imputa a los gráficos y KPIs consumos realizados en meses previos o en cuotas. Al filtrar el dashboard por categoría o etiqueta, `TransactionList` solo miraba transacciones del rango de fechas activo, mostrando `Movimientos (0)` aunque los gráficos sí reflejaban ese consumo.
   - *Decisión:* se mantiene intacta la contabilidad `cash` (Opción B), pero `/api/bootstrap` incorpora `paid_statement_items` y `referencedTransactions` para que el listado filtrado incluya los ítems de meses previos/cuotas pagados en el período y coincida 100% con los gráficos.

3. **Pagos parciales y múltiples de resumen (`pending` / `partial` / `paid`):**
   - *Por qué:* la suposición inicial de "1 transferencia = resumen pagado" fallaba ante adelantos o pagos en dos tramos: el primer pago parcial ocultaba alertas de vencimiento (`is_overdue`) y cada transferencia adicional volvía a absorber `third_party_total` desde cero.
   - *Decisión:* se reemplaza por agregación cronológica acumulada por `(tarjeta, statement_month)` (`remaining_due`, `paid_transaction_ids`, `paid_amount`, `status: 'pending' | 'partial' | 'paid'`).

4. **Seguridad *fail-closed* por defecto:**
   - *Por qué:* en v3.0, si faltaba `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_TELEGRAM_USER_ID` o `auth_date` en `initData`, el endpoint aceptaba peticiones en lugar de rechazarlas, y no se validaba que los mensajes de Telegram provinieran del chat privado del dueño (`chat.id === allowedId`).
   - *Decisión:* `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_TELEGRAM_USER_ID`, `DASHBOARD_TOKEN`, `auth_date` obligatorio en `initData` y chats privados (`chat.id === allowedId`) pasan a ser obligatorios (*fail-closed*) con comparación en tiempo constante vía SHA-256.

5. **`wrangler.toml` excluido de Git:**
   - *Por qué:* tener `wrangler.toml` trackeado contradecía la guía del `README.md` y exponía el `database_id` y `DASHBOARD_URL` personales de despliegue.
   - *Decisión:* `wrangler.toml` se incorpora a `.gitignore` (preservando solo `wrangler.example.toml` en el repositorio), blindando la Invariante #1.

---

## 5. Comandos y Entorno Local

```bash
# Instalar dependencias
npm install
npm --prefix web install

# Desarrollo local (Worker + Assets + D1 local) y dev frontend Vite
npm run dev
npm run dev:web

# Migraciones D1
npm run db:migrate:local
npm run db:migrate:staging
npm run db:migrate:remote

# Validación obligatoria antes de cualquier commit/merge
npm test        # Vitest
npm run build   # web tsc -b + vite build + root tsc --noEmit

# Despliegue a staging (bot/DB de pruebas) y producción (solo desde main, tras confirmar)
npm run deploy:staging
npm run deploy
```

> **Nota Windows / PowerShell 5.1:** PowerShell 5.1 no soporta `&&`; usá `;` o `cmd /c "comando1 && comando2"`. Si `wrangler dev` bloquea archivos SQLite en `.wrangler/state/v3/d1` al intentar borrar la carpeta para resetear local, reseteá las tablas ejecutando `DROP TABLE IF EXISTS ...` vía `npx wrangler d1 execute wallet-db --local --command "..."` y luego `npm run db:migrate:local`.

---

## 6. Flujo Git y Reglas de Seguridad

- **Ramas:**
  - `main`: producción exacta (nunca desarrollar directo en `main`).
  - `dev`: integración estable.
  - `feat/<nombre>`, `test/<nombre>`, `fix/<nombre>`, `docs/<nombre>`: ramas temáticas para cada trabajo nuevo. Ver backlog detallado en [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **Confirmación explícita requerida antes de:**
  - `git commit` o `git push`.
  - `npm run deploy` o `npm run db:migrate:remote`.
  - Cualquier comando destructivo o escritura sobre `wallet-db --remote`.
