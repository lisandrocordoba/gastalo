# Bot de Telegram y Ambiente Staging — Gasti Personal

Este documento detalla el alcance funcional del bot de Telegram (**qué puede hacer**, **qué no hace**, cómo informa sus límites) y cómo configurar un segundo bot aislado en **`staging`** para probar prompts reales y cambios sin tocar producción.

---

## 1. Qué SÍ puede hacer el bot

### Entrada multimodal
- **Texto libre**, **notas de voz / audio** y **fotos de tickets o comprobantes** (hasta **4 MB**).
- Deduplicación automática por `telegram_message_id` ante reintentos del webhook.
- Seguridad *fail-closed*: solo responde al `ALLOWED_TELEGRAM_USER_ID` en su chat privado (`chat.id === from.id`) cuando `TELEGRAM_WEBHOOK_SECRET` coincide.

### Registro rápido de movimientos (`intent: "record"`)
- **Gastos e ingresos (`expense`, `income`)** en `ARS`, `USD` o `BRL`, con detección automática de cuenta/tarjeta y categoría.
- **Compras en cuotas (`installments_total >= 2`)** sobre tarjetas de crédito, respetando el `closing_day` de la tarjeta si no se indica un primer mes explícito.
- **Compras compartidas y terceros (`third_party`, `third_party_repayment`, `createSharedPurchase`):** divide en la parte propia y la parte cobrable a otra persona.
- **Inversiones (`investment`)** y **mes contable (`budget_month`)** para imputar sueldos/ingresos de fin de mes al mes siguiente.
- **Transferencias y pagos de resumen de tarjeta (`transfer`):**
  - En la **misma moneda**, con `statement_month` automático o indicado cuando el destino es tarjeta.
  - **Entre monedas distintas (`to_amount`):** indicando ambos montos (ej. *"Pagué 6,69 USD de Tarjeta USD con $10.350 desde Billetera"* o *"Compré 50 USD a 75k"*). Si falta uno de los dos montos, el bot pide aclararlo en vez de inventar el tipo de cambio.

### Configuración y gastos fijos por chat (`intent: "manage"`)
- **Crear cuentas y tarjetas (`create_account`):** billetera, ahorro/reservas, efectivo o tarjeta de crédito (`ARS`, `USD`, `BRL`), con saldo inicial, flag principal, `closing_day` y `due_day`.
- **Crear categorías (`create_category`)** y **etiquetas (`create_tag`)**.
- **Crear gastos o ingresos fijos mensuales (`create_recurring`):** por ejemplo *"Agregá gasto fijo en Tarjeta USD: Streaming 5 USD, arranca en 2026-12"*. Incluye botón `🗑️ Eliminar` (`delrec:<id>`).

### Consultas y comandos
- **Preguntas por texto o voz (`intent: "query"`):** consulta ingresos, gastos `cash`, saldos, tarjetas, resúmenes vencidos (mostrando `remaining_due` e indicando pagos parciales), proyección a 3 meses y gastos fijos activos, tanto del **mes actual** como de **meses anteriores/específicos** (`query_month`).
- **Comandos:**
  - `/start`, `/ayuda`, `/help` — Guía de uso, comandos y límites del bot.
  - `/cuentas`, `/config` — Saldos actuales y ejemplos de alta por chat.
  - `/fijos`, `/suscripciones` — Gastos fijos y suscripciones activas.
  - `/resumen [YYYY-MM]`, `/mes [YYYY-MM]` — Métricas del mes actual o indicado (ej. `/resumen 2026-10`).
  - `/saldos` — Saldos, alertas de resúmenes vencidos (`remaining_due`) y pendientes de terceros.
  - `/futuro` — Cuotas y fijos de los próximos 3 meses vs. cuentas de ahorro/reservas.
  - `/ultimos` — Últimos 5 movimientos.

### Botones inline tras registrar un movimiento
- `✅ OK` · `✏️ Categoría` · `🔄 Cuenta` · `🏷️ Etiquetas` · `🛡️ Pasar a Reservas` (en devoluciones de terceros) · `🗑️ Borrar` (o `🗑️ Eliminar` al crear cuentas/categorías/etiquetas/fijos).

---

## 2. Qué NO hace el bot (y respuesta explícita `unsupported`)

Telegram está enfocado en **captura ágil, consultas al paso y alertas**. Las acciones con alto riesgo de ambigüedad o edición fina viven en el **Dashboard / Mini App**:

| Acción no soportada por Telegram | Dónde realizarla en el Dashboard |
| :--- | :--- |
| Editar o corregir montos, fechas, cuotas o `budget_month` de movimientos históricos (o borrar movimientos pasados por texto libre). | Sección **Movimientos** (`✏️` / `🗑️`). *(Solo el último mensaje registrado ofrece botones rápidos de categoría/cuenta/etiquetas/borrar).* |
| Editar, pausar o eliminar cuentas, tarjetas, categorías, etiquetas o gastos fijos ya existentes. | Botón **Configurar** o tarjeta **Próximos meses / Fijos**. |
| Conciliar manualmente el saldo real de una cuenta. | Botón `⚖️` dentro de **Cuentas**. |
| Pagar un resumen con desglose de sellos/intereses (`fees_amount`) o postear una suscripción fija como consumo del resumen de tarjeta. | Sección **Tarjetas de crédito**. |
| Exportar movimientos en CSV o comparar rangos históricos multi-mes/multi-año. | Barra superior del Dashboard (`CSV`, selector de rango y gráficos). |

Cuando le pedís alguna de estas operaciones por chat, Gemini clasifica el pedido con **`intent: "unsupported"`** en lugar de inventar un movimiento erróneo, y el bot responde indicando **qué no permite hacer**, **en qué sección del Dashboard hacerlo** y un botón directo **`📊 Abrir Dashboard`** (si `DASHBOARD_URL` está configurado). Además, `/ayuda` y `/start` resumen estos límites al final del mensaje.

---

## 3. Ambiente `staging` con segundo bot de pruebas

Configurar un segundo Worker y D1 en `staging` permite probar prompts reales de Gemini, notas de voz, tickets y webhooks sin tocar los datos ni el bot de producción (`$0/mes` en Workers Free).

### Paso 1: Crear el segundo bot en Telegram
1. En Telegram abrí **@BotFather** y ejecutá `/newbot` (por ej. `Gasti Staging Bot` → `@tu_gasti_staging_bot`).
2. Guardá el nuevo token devuelto (`TELEGRAM_BOT_TOKEN` de staging).
3. Verificá tu ID numérico personal con `@userinfobot` (`ALLOWED_TELEGRAM_USER_ID`, suele ser el mismo que usás en producción).

### Paso 2: Crear D1 y configurar `[env.staging]`
1. Creá una base D1 separada para pruebas:
   ```bash
   npx wrangler d1 create wallet-db-staging
   ```
2. En tu [`wrangler.toml`](../wrangler.toml) local (archivo ignorado por Git; ver plantilla en [`wrangler.example.toml`](../wrangler.example.toml)), agregá la sección `[env.staging]` con el `database_id` de `wallet-db-staging` y tu `DASHBOARD_URL` de staging (`https://<tu-worker-staging>.workers.dev`).
3. Aplicá las migraciones en la D1 de staging:
   ```bash
   npm run db:migrate:staging
   ```

### Paso 3: Cargar secretos y desplegar `staging`
1. Cargá los 5 secretos obligatorios para `--env staging` (generá valores aleatorios distintos para `TELEGRAM_WEBHOOK_SECRET` y `DASHBOARD_TOKEN`):
   ```bash
   npx wrangler secret put GEMINI_API_KEY --env staging
   npx wrangler secret put TELEGRAM_BOT_TOKEN --env staging
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
   npx wrangler secret put ALLOWED_TELEGRAM_USER_ID --env staging
   npx wrangler secret put DASHBOARD_TOKEN --env staging
   ```
2. Desplegá al ambiente `staging`:
   ```bash
   npm run deploy:staging
   ```

### Paso 4: Conectar el webhook del bot de pruebas
Apuntá el segundo bot al Worker de staging (reemplazando `<STAGING_BOT_TOKEN>`, `<TU-WORKER-STAGING>` y `<STAGING_WEBHOOK_SECRET>`):
```bash
curl -X POST "https://api.telegram.org/bot<STAGING_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<TU-WORKER-STAGING>.workers.dev/webhook/telegram","secret_token":"<STAGING_WEBHOOK_SECRET>"}'
```

> **Tip:** desde `@BotFather` también podés usar `/setmenubutton` sobre tu bot de staging apuntando a `https://<TU-WORKER-STAGING>.workers.dev` para abrir la Mini App contra D1 de pruebas.
