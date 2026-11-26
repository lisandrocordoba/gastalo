# Plan de Evolución v3.0 — Aplicación Agnóstica y Configurable

> **Estado:** Completado y desplegado en producción (`v3.0`).  
> **Documentos hermanos:** [Arquitectura e Infraestructura](ARQUITECTURA.md) · [Modelo de Datos y Casos de Uso](MODELO_DATOS.md) · [Roadmap y Próximos Pasos](ROADMAP.md).

---

## 1. Objetivo de v3.0

Transformar **Gasti Personal** en una **aplicación financiera 100% agnóstica y multipropósito**: cualquier persona que despliegue el proyecto desde cero arranca con una instancia limpia —sin cuentas bancarias, tarjetas ni etiquetas propias del autor— y configura todo a su medida desde la **interfaz web** o conversacionalmente desde **Telegram**.

### Principios clave
1. **Esquema único inicial limpio (`migrations/0001_initial.sql`):**
   - Crea el esquema completo v3 (`accounts` con `color`, `categories`, `transactions` con cuotas/terceros/`statement_month`, `tags`, `transaction_tags`, `recurring_items`).
   - Arranca con **0 cuentas** y **0 movimientos** (cero menciones a Mercado Pago, BBVA, Efectivo o personas reales).
   - Incluye únicamente una **base genérica, editable y eliminable** de **18 categorías de gasto + 4 de ingreso** y **5 etiquetas universales** (`#casa`, `#hormiga`, `#familia`, `#vacaciones`, `#emergencia`).
2. **Migración personal 100% fuera de la app:** el script para importar el historial desde *Wallet by BudgetBakers* (`.xls`) vive exclusivamente en local dentro de `imports/` (ignorado en `.gitignore`), completamente separado del código fuente y de las migraciones del proyecto.
3. **Configuración dual (Web + Telegram):** alta, edición y borrado de **cuentas líquidas, reservas/ahorros, efectivo, tarjetas de crédito (en cualquier moneda), categorías y etiquetas** desde ambos canales.
4. **Resolución por capacidades, nunca por IDs fijos:** toda la lógica de negocio, Gemini y Telegram opera sobre `is_default`, `type` (`wallet`, `savings`, `cash`, `credit_card`) y `currency`, sin depender jamás de IDs como `'mp'`, `'mp_reservas'` o `'bbva_credito'`.

---

## 2. Auditoría de Acoplamientos Detectados (v2.1 → v3.0)

| Capa / Archivo | Acoplamiento en v2.1 | Solución en v3.0 |
| :--- | :--- | :--- |
| `migrations/0001..0003` | Seeds fijos de cuentas personales (`mp`, `mp_reservas`, `efectivo`, `bbva_credito`, `bbva_credito_usd`, `mp_credito`) y tags `#abril`, `#hw`. | Esquema único limpio en [`migrations/0001_initial.sql`](../migrations/0001_initial.sql) con **0 cuentas**, categorías genéricas y 5 tags genéricos. |
| `scripts/import-wallet.mjs`, `wallet-mapper.mjs` | Script e importador personal dentro del repositorio y `package.json`. | Movidos fuera del repo a `imports/wallet-migration/` (gitignored), auto-creando sus propias cuentas al generar el SQL local. |
| [`src/db.ts`](../src/db.ts) | `payCardStatement` hace fallback a `'mp'`; `getFutureProjection` busca `a.id === 'mp_reservas'`; sin CRUD de cuentas/categorías ni borrado de tags. | CRUD completo con integridad referencial (`409 Conflict`), `pickDefaultLiquidAccount()` y `computeSavingsBalance()`. |
| [`src/index.ts`](../src/index.ts) | Solo `PATCH /api/accounts/:id` (`initial_balance`) y `reconcile`; fallback `'mp'` en `/pay-statement`; sin CRUD de cuentas/categorías ni `PATCH/DELETE` de tags. | Rutas completas para `/api/accounts`, `/api/categories` y `/api/tags`. |
| [`src/gemini.ts`](../src/gemini.ts) | Prompt e intención con IDs fijos (`mp`, `mp_reservas`, `bbva_credito_usd`, `#abril`, `#hw`, `Jere`, `Tuenti`). | Prompt 100% dinámico desde DB; nuevo `intent: 'manage'` para dar de alta cuentas, tarjetas, categorías y etiquetas por chat. |
| [`src/telegram.ts`](../src/telegram.ts) | Botón `[🛡️ Pasar a Reservas]` atado a `mp → mp_reservas`; textos y comandos (`/ayuda`, `/saldos`, `/futuro`) nombran `MP`, `BBVA`, `Jere`. | Botón dinámico si existe cuenta `savings`; comando `/cuentas`; mensajes sin nombres fijos; guía si hay 0 cuentas cargadas. |
| `web/src/components/*` | Sin UI para crear/editar/eliminar cuentas, tarjetas ni categorías; colores por ID; placeholders personales; años fijos `2022..2026`. | Modales de Cuenta/TC y Configuración (`⚙️ Configurar`), onboarding vacío cuando `accounts.length === 0`, textos genéricos y años dinámicos. |
| [`wrangler.toml`](../wrangler.toml), [`README.md`](../README.md), `docs/` | `database_id` / `DASHBOARD_URL` personales y documentación acoplada al flujo del autor. | `wrangler.example.toml`, [`README.md`](../README.md) y docs actualizados para cualquier usuario que clone el repo. |

---

## 3. Esquema Consolidado v3 (`migrations/0001_initial.sql`)

- **`accounts`**: `(id, name, type, currency, initial_balance, color, is_default, due_day, created_at)` — inicia **vacía**.
- **`categories`**: `(id, name, icon, type, color)` — base genérica editable/eliminable de **18 categorías de gasto + 4 de ingreso** con paleta de colores coherente.
- **`tags`**: `(id, name, color)` — 5 etiquetas iniciales (`#casa`, `#hormiga`, `#familia`, `#vacaciones`, `#emergencia`), editables y eliminables.
- **`transactions`**: `(id, type, amount, currency, account_id, to_account_id, category_id, description, occurred_at, source, raw_input, telegram_message_id, installments_total, first_installment_month, statement_month, budget_month, third_party_name, linked_group_id, created_at)`.
- **`transaction_tags`** (`ON DELETE CASCADE`) y **`recurring_items`** (incluye `start_month` para suscripciones y fijos mensuales).

---

## 4. Contrato de APIs CRUD e Integridad Referencial

### A. Cuentas y Tarjetas (`/api/accounts`)
| Método | Ruta | Comportamiento |
| :--- | :--- | :--- |
| `GET` | `/api/accounts` | Lista todas las cuentas con saldo calculado (`AccountWithBalance[]`). |
| `POST` | `/api/accounts` | Crea cuenta o TC: `{ name, type, currency, initial_balance?, color?, is_default? }`. Genera `id` slug único (`slugifyId`). Si es la primera cuenta líquida (o `is_default: 1`), queda marcada por defecto (`credit_card` nunca es `is_default`). |
| `PATCH` | `/api/accounts/:id` | Actualiza `{ name?, type?, currency?, initial_balance?, color?, is_default? }`. Bloquea con `409 Conflict` el cambio de `currency` si ya tiene movimientos registrados; mantiene unicidad de `is_default`. |
| `DELETE` | `/api/accounts/:id` | Bloquea con **`409 Conflict`** si tiene movimientos (`account_id`/`to_account_id`) o gastos fijos vinculados. Si tiene `0` referencias, elimina y promueve otra cuenta líquida si era `is_default`. |

### B. Categorías (`/api/categories`)
| Método | Ruta | Comportamiento |
| :--- | :--- | :--- |
| `GET` | `/api/categories` | Lista todas las categorías (`expense`, `income`, `both`). |
| `POST` | `/api/categories` | Crea `{ name, icon, type, color }` generando `id` slug único. |
| `PATCH` | `/api/categories/:id` | Edita `{ name?, icon?, type?, color? }`. |
| `DELETE` | `/api/categories/:id` | Bloquea con **`409 Conflict`** si tiene movimientos o gastos fijos vinculados. |

### C. Etiquetas (`/api/tags`)
| Método | Ruta | Comportamiento |
| :--- | :--- | :--- |
| `GET` | `/api/tags` | Lista todas las etiquetas. |
| `POST` | `/api/tags` | Crea o actualiza etiqueta `{ name, color? }`. |
| `PATCH` | `/api/tags/:id` | Edita `{ name?, color? }`. |
| `DELETE` | `/api/tags/:id` | Elimina la etiqueta (desasocia automáticamente vía `ON DELETE CASCADE`). |

---

## 5. Desacoplamiento de IA (`src/gemini.ts`) y Bot (`src/telegram.ts`)

1. **Nuevo `intent: 'manage'` en Gemini:**
   - Permite crear desde lenguaje natural (texto o nota de voz):
     - Cuentas líquidas, de ahorro/reservas o efectivo (`"Creá cuenta Banco Galicia en ARS"`, `"Agregá caja de ahorro Reserva USD en dólares"`).
     - Tarjetas de crédito (`"Agregá tarjeta Visa Santander en pesos"`).
     - Categorías (`"Creá la categoría Gimnasio"`).
     - Etiquetas (`"Creá la etiqueta #viaje"`).
2. **Prompt y sanitización 100% dinámicos:**
   - `parseMessageWithGemini` inyecta únicamente las cuentas, categorías y etiquetas reales existentes en D1 en ese momento.
   - `sanitizeParsedIntent` resuelve fallbacks vía `is_default` y coincidencia de `type`/`currency` (ej. si el usuario indica USD y una TC compatible en USD existe, la selecciona sin depender de nombres fijos).
   - Si el usuario aún no tiene cuentas (`accounts.length === 0`) e intenta cargar un gasto, el bot responde guiándolo para crear su primera cuenta en el mismo chat o desde la Web.
3. **Bot de Telegram agnóstico:**
   - Nuevo comando `/cuentas` que lista cuentas, tarjetas, moneda y saldo actual.
   - Botón `[🛡️ Pasar a <NombreCuentaReserva>]` dinámico en reembolsos solo cuando exista alguna cuenta con `type = 'savings'` distinta a la cuenta de origen.

---

## 6. Experiencia de Usuario en Dashboard Web (`web/`)

1. **Onboarding cuando `accounts.length === 0`:**
   - Tarjeta de bienvenida con pasos claros para crear cuentas/tarjetas desde la Web o por Telegram, más botones directos `+ Nueva cuenta` y `+ Nueva tarjeta`.
2. **Gestión completa en interfaz:**
   - Botones `+ Nueva cuenta` (en `AccountsGrid`) y `+ Nueva tarjeta` (en `CreditCardsSection`), y botón de edición en cada tarjeta/cuenta (`AccountModal`: nombre, tipo, moneda, color, saldo inicial, predeterminada, eliminar).
   - Botón `⚙️ Configurar` en el header (`SettingsModal`) con pestañas **Cuentas y TC**, **Categorías**, **Etiquetas** y **Fijos / Suscr.** (+ modal unificado `RecurringModal` para gastos fijos/suscripciones y alertas persistentes por `due_day`).
   - Textos, placeholders y selector de años (`DateRangePicker`) completamente genéricos y dinámicos.

---

## 7. Plan de Etapas y Versionado Explicativo (rama `dev` → `main`)

| Etapa | Alcance | Archivos principales | Commit sugerido |
| :--- | :--- | :--- | :--- |
| **Etapa 3.1** | Documentación del plan v3 agnóstico | `docs/PLAN_V3_AGNOSTICO.md` | `docs(v3): definir plan de arquitectura agnostica sin seeds personales` |
| **Etapa 3.2** | Esquema único limpio `0001`, migrador fuera del repo (`imports/`), CRUD backend completo y tests | `migrations/0001_initial.sql`, `package.json`, `src/types.ts`, `src/utils.ts`, `src/db.ts`, `src/index.ts`, `test/core.test.ts` | `feat(api,db): esquema limpio v3 y CRUD completo de cuentas, categorias y etiquetas` |
| **Etapa 3.3** | Gemini y Telegram 100% dinámicos + `intent: 'manage'` y comando `/cuentas` | `src/gemini.ts`, `src/telegram.ts`, `src/types.ts`, `test/core.test.ts` | `feat(bot,ai): alta conversacional de cuentas/categorias y prompts 100% dinamicos` |
| **Etapa 3.4** | UI de gestión de cuentas, TC, categorías y etiquetas + onboarding vacío | `web/src/api.ts`, `web/src/types.ts`, `web/src/App.tsx`, `web/src/components/*` | `feat(web): CRUD visual de cuentas, TC, categorias y etiquetas + onboarding vacio` |
| **Etapa 3.5** | Plantilla `wrangler.example.toml`, limpieza de `README.md` y `docs/ARQUITECTURA.md` | `wrangler.example.toml`, `README.md`, `docs/ARQUITECTURA.md` | `docs(setup): agregar plantilla wrangler.example.toml y guia de despliegue agnostico` |
| **Etapa 3.6** | Validación integral en D1 local vacío + importación externa local, reset D1 remoto, merge `dev → main` y deploy | `main`, Cloudflare D1 remoto, Cloudflare Worker | `chore(release): desplegar Gasti v3 agnostico en produccion` |
