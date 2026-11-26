# AGENTS.md — Guía de Mantenimiento para Agentes (Gasti Personal)

Este documento es el punto de entrada técnico para cualquier agente de desarrollo que mantenga o extienda **Gasti Personal** (aplicación de finanzas personales **v3.0**, 100% agnóstica y serverless sobre Cloudflare Workers + D1).

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
| [`src/index.ts`](src/index.ts) | Entrypoint Hono: `/webhook/telegram`, `/api/bootstrap`, CRUD `/api/accounts`, `/api/categories`, `/api/tags`, `/api/recurring`, `/api/transactions`, `/api/cards/:id/pay-statement`, `/api/projection`, `/api/export.csv`, `/api/health`. |
| [`src/db.ts`](src/db.ts) | Consultas D1 y funciones puras de negocio/contabilidad (`computeAccountBalances`, `computeCardStatements`, `computeOverdueCardAlerts`, `computePeriodMetrics`, `computeFutureProjection`, `payCardStatement`, `reconcileAccountBalance`, CRUD con `ConflictError` `409`). |
| [`src/gemini.ts`](src/gemini.ts) | Esquema JSON estricto (`PARSE_SCHEMA`), sanitización (`sanitizeParsedIntent`), parser multimodal (`record` / `query` / `manage`) y respuestas de consultas (`answerFinancialQuery`). |
| [`src/telegram.ts`](src/telegram.ts) | Comandos (`/start`, `/cuentas`, `/saldos`, `/resumen`, `/futuro`, `/ultimos`), botones inline (`ok`, `catm`, `accm`, `tagm`, `resv`, `del`, `delacc`, `delcat`, `deltag`), manejo de texto/audio/foto. |
| [`src/auth.ts`](src/auth.ts) | Validación constante de `DASHBOARD_TOKEN` (`Bearer`) y verificación criptográfica HMAC-SHA256 de Telegram `initData`. |
| [`src/types.ts`](src/types.ts) | Contratos TypeScript compartidos de backend. |
| [`src/utils.ts`](src/utils.ts) | Helpers de zona horaria (`todayInTimezone`, `currentMonthInTimezone`), meses (`addMonths`, `monthDiff`, `previousMonths`), IDs y formato ARS/USD. |
| [`migrations/0001_initial.sql`](migrations/0001_initial.sql) | Esquema limpio v3 ya aplicado en producción (`0` cuentas iniciales, `22` categorías base, `5` etiquetas base). |
| [`web/src/App.tsx`](web/src/App.tsx) | Orquestador de estado del Dashboard, filtros y montaje único de modales. |
| [`web/src/api.ts`](web/src/api.ts) | Cliente HTTP hacia `/api/*` y formateo monetario (`formatMoney`). |
| [`web/src/components/`](web/src/components/) | `SummaryCards`, `CurrentStatusBar`, `AccountsGrid`, `CreditCardsSection`, `CategoryChart`, `MonthlyChart`, `TagsPanel`, `FutureProjectionCard`, `TransactionList`, `AccountModal`, `RecurringModal`, `TransactionModal`, `SettingsModal`, `DateRangePicker`. |
| [`test/core.test.ts`](test/core.test.ts) | Tests unitarios de lógica contable, cuotas, `budget_month`, `start_month`, `due_day`, alertas vencidas, auth y `sanitizeParsedIntent`. |
| [`docs/`](docs/) | [`ARQUITECTURA.md`](docs/ARQUITECTURA.md), [`MODELO_DATOS.md`](docs/MODELO_DATOS.md), [`PLAN_V3_AGNOSTICO.md`](docs/PLAN_V3_AGNOSTICO.md) y [`ROADMAP.md`](docs/ROADMAP.md). |
| `wrangler.example.toml` / `.dev.vars.example` | Plantillas públicas para levantar instancias limpias sin secretos ni IDs propios. |
| `imports/`, `.dev.vars`, `.wrangler/`, `.agent/` | **Ignorados en `.gitignore`.** Contienen datos personales del usuario (CSV, script de migración local, secretos y estado D1 local). **Nunca** trackear ni subir a Git. |

---

## 3. Invariantes Críticas de Dominio (No Romper)

1. **Repositorio 100% agnóstico:**
   - **Prohibido** hardcodear nombres propios, bancos, tarjetas personales, personas reales o IDs fijos (`'mp'`, `'bbva'`, `'abril'`, etc.) en código, migraciones, tests o docs.
   - Resolver cuentas por capacidades (`is_default = 1`, `type IN ('wallet','savings','cash','credit_card')`, `currency`).

2. **Contabilidad de tarjetas (`expense` vs. `transfer` con `statement_month`):**
   - Los `expense` y `third_party` en una `credit_card` descuentan el saldo de la tarjeta al instante (deuda negativa), pero **no** suman en consumo `cash` del período al pasar la tarjeta.
   - El gasto entra en consumo real recién cuando se paga el resumen mediante `transfer` con `to_account_id = card.id` y `statement_month` (`YYYY-MM`), prorrateando solo la porción propia (`own_total`) por categoría y etiqueta.
   - `third_party` y `third_party_repayment` nunca suman al consumo personal ni a ingresos.

3. **Semántica de fechas y vencimientos:**
   - `occurred_at` (`YYYY-MM-DD`): fecha real bancaria; **siempre** manda en saldos actuales.
   - `budget_month` (`YYYY-MM`, opcional): permite imputar ingresos de fin de mes al mes siguiente en KPIs, gráficos y listados (`effectiveTransactionDate`), sin alterar saldos.
   - `recurring_items.start_month` (`YYYY-MM`, opcional): en tarjetas marca el *primer resumen*; en proyección futura filtra meses `>= start_month`. `day_of_month` es opcional y solo referencia para fechar el cargo dentro de `statement_month`.
   - `accounts.due_day` (`1–31`, opcional, solo `credit_card`): `computeCardStatements` calcula `due_date` haciendo clamp al último día del mes y marca `is_overdue: true` solo si `!paid && total_due > 0 && today > due_date`. `computeOverdueCardAlerts` revisa todos los meses candidatos `<= hoy` para mantener el banner superior fijo sin importar el período seleccionado.

4. **Fuente única de verdad en UI:**
   - Los modales principales (`AccountModal.tsx`, `RecurringModal.tsx`, `TransactionModal.tsx`) se montan **una sola vez** en `web/src/App.tsx`.
   - Cualquier botón nuevo en distintas secciones (`SettingsModal`, `CreditCardsSection`, `FutureProjectionCard`) debe abrir el modal compartido vía props, sin duplicar formularios embebidos ni estados paralelos.
   - Si se cambia la cuenta de una transacción o gasto fijo (`PATCH /api/recurring/:id` o callback de Telegram), mantener sincronizada `currency`.

5. **Migraciones D1 inmutables:**
   - `migrations/0001_initial.sql` **ya está aplicada en producción**.
   - Todo cambio futuro de esquema **debe** crearse como un nuevo archivo numerado (`migrations/0002_...sql`, `0003_...sql`) y probarse primero en `--local`.

6. **SDK de Gemini:**
   - Usar únicamente `@google/genai` con `ai.interactions.create` (`GEMINI_MODEL = 'gemini-3.5-flash-lite'`), nunca APIs legacy.

---

## 4. Comandos y Entorno Local

```bash
# Instalar dependencias
npm install
npm --prefix web install

# Desarrollo local (Worker + Assets + D1 local) y dev frontend Vite
npm run dev
npm run dev:web

# Migraciones D1
npm run db:migrate:local
npm run db:migrate:remote

# Validación obligatoria antes de cualquier commit/merge
npm test        # Vitest (test/core.test.ts)
npm run build   # web tsc -b + vite build + root tsc --noEmit

# Despliegue a producción (solo desde main, tras confirmar con el usuario)
npm run deploy
```

> **Nota Windows / PowerShell 5.1:** PowerShell 5.1 no soporta `&&`; usá `;` o `cmd /c "comando1 && comando2"`. Si `wrangler dev` bloquea archivos SQLite en `.wrangler/state/v3/d1` al intentar borrar la carpeta para resetear local, reseteá las tablas ejecutando `DROP TABLE IF EXISTS ...` vía `npx wrangler d1 execute wallet-db --local --command "..."` y luego `npm run db:migrate:local`.

---

## 5. Flujo Git y Reglas de Seguridad

- **Ramas:**
  - `main`: producción exacta (nunca desarrollar directo en `main`).
  - `dev`: integración estable.
  - `feat/<nombre>`, `test/<nombre>`, `fix/<nombre>`, `docs/<nombre>`: ramas temáticas para cada trabajo nuevo. Ver backlog detallado en [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **Confirmación explícita requerida antes de:**
  - `git commit` o `git push`.
  - `npm run deploy` o `npm run db:migrate:remote`.
  - Cualquier comando destructivo o escritura sobre `wallet-db --remote`.
