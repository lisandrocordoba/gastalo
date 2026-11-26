# Gasti Personal (Telegram + Gemini + Cloudflare Workers/D1 + PWA)

Asistente de finanzas personales 100% gratuito (\$0/mes) y **agnóstico**: al levantarlo arranca limpio (sin cuentas predefinidas) para que configures tus propios bancos, billeteras, efectivo, cuentas de ahorro/reservas y tarjetas de crédito (ARS, USD u otras monedas) desde el **Dashboard Web** o conversacionalmente por **Telegram**.

### Características principales
- **Configuración flexible (Web + Bot):** alta, edición, color, cuenta principal por defecto y eliminación protegida de cuentas, tarjetas de crédito (con día de vencimiento `due_day`), categorías y etiquetas.
- **Bot de Telegram con IA multimodal (`gemini-3.5-flash-lite`):** entiende texto libre, notas de voz y fotos de tickets/comprobantes para registrar movimientos (`expense`, `income`, `transfer`, `investment`, `third_party`, `third_party_repayment`), pagar resúmenes de TC (`statement_month`), imputar ingresos al mes siguiente (`budget_month`), responder consultas (con resúmenes y vencimientos) o crear cuentas/categorías/etiquetas por chat (`/cuentas`).
- **Tarjetas de crédito con flujo real (Opción B) y alertas de vencimiento:** las compras con tarjeta suman deuda real al instante sin distorsionar los gastos mensuales de efectivo/billetera; al registrar el pago del resumen (`💳 Pagar resumen` o por Telegram), se descuentan deuda y saldo líquido e ingresan al consumo desglosados por categoría. Si configurás el día de vencimiento en la TC, un banner fijo superior avisa cuando hay resúmenes vencidos sin pagar.
- **Cuotas, suscripciones, compartidos y proyección futura:** control de compras en cuotas, suscripciones asociadas a tarjetas o cuentas líquidas con mes de inicio (`start_month`) desde un único modal (`⚙️ Configurar` → *Fijos / Suscr.* o sección Tarjetas/Proyección), proyección ARS + USD a 3 meses vs. tus cuentas de reservas, división de gastos con terceros, filtro interactivo y mes contable opcional (`budget_month`).
- **Dashboard Web (PWA + Telegram Mini App):** gráficos interactivos, conciliación rápida de saldo (`⚖️`), ordenamiento por fecha/monto y exportación a CSV.

> 📘 **Arquitectura e infraestructura:** [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)  
> 📐 **Modelo contable y casos de uso:** [docs/MODELO_DATOS.md](docs/MODELO_DATOS.md)  
> 🧭 **Plan v3 agnóstico:** [docs/PLAN_V3_AGNOSTICO.md](docs/PLAN_V3_AGNOSTICO.md)  
> 🗺️ **Roadmap y próximos pasos:** [docs/ROADMAP.md](docs/ROADMAP.md)

---

## Requisitos (todo con plan gratuito)
1. **Cuenta en Telegram** (para crear el bot).
2. **Cuenta en Google AI Studio** (para obtener `GEMINI_API_KEY` gratis).
3. **Cuenta en Cloudflare** (Workers + D1 tienen tier gratuito sin tarjeta ni pausas).

---

## Paso 1: Crear el bot de Telegram y obtener tu ID
1. Abrí **@BotFather** en Telegram y ejecutá `/newbot`.
2. Copiá el token que te entrega (`TELEGRAM_BOT_TOKEN`).
3. Abrí **@userinfobot** (o `@RawDataBot`) y copiá tu número de usuario (`ALLOWED_TELEGRAM_USER_ID`) para que nadie más pueda usar tu bot.
4. Opcional: desde `@BotFather` podés usar `/setmenubutton` para vincular la URL de tu Worker como botón de Mini App.

---

## Paso 2: Obtener la API Key de Gemini
1. Entrá a [Google AI Studio](https://aistudio.google.com/apikey).
2. Creá una API Key gratuita (`GEMINI_API_KEY`).

---

## Paso 3: Instalar dependencias y probar en local
```bash
npm install
npm --prefix web install

# Copiar configuración de Cloudflare y secretos locales
cp wrangler.example.toml wrangler.toml
cp .dev.vars.example .dev.vars
# Completar .dev.vars con tus claves

# Crear la base de datos local y aplicar el esquema limpio
npm run db:migrate:local

# Ejecutar tests y verificar build
npm test
npm run build
```

Para correr el entorno local:
```bash
npm run dev
```

---

## Paso 4: Desplegar gratis en Cloudflare
1. Logueate en Wrangler:
   ```bash
   npx wrangler login
   ```
2. Creá la base de datos D1:
   ```bash
   npx wrangler d1 create wallet-db
   ```
   Copiá el `database_id` que imprime y actualizalo en `wrangler.toml` junto con tu `DASHBOARD_URL`.
3. Aplicá las migraciones en la nube:
   ```bash
   npm run db:migrate:remote
   ```
4. Cargá los secretos en Cloudflare:
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put ALLOWED_TELEGRAM_USER_ID
   npx wrangler secret put DASHBOARD_TOKEN
   ```
   *(Para `TELEGRAM_WEBHOOK_SECRET` y `DASHBOARD_TOKEN` podés usar cualquier string largo aleatorio).*
5. Desplegá la app completa (frontend + worker):
   ```bash
   npm run deploy
   ```
6. Conectá el webhook de Telegram apuntando a tu URL de Worker (reemplazá `<TOKEN>`, `<TU-WORKER>` y `<SECRET>`):
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://<TU-WORKER>.workers.dev/webhook/telegram","secret_token":"<SECRET>"}'
   ```

---

## Primeros pasos y uso diario
1. **Creá tus primeras cuentas** desde el onboarding del Dashboard (`+ Crear primera cuenta` / `+ Agregar tarjeta`) o directo por Telegram:
   - `"Creá mi cuenta principal Billetera en ARS"`
   - `"Creá cuenta de ahorros Reservas en ARS"`
   - `"Agregá tarjeta de crédito Visa en ARS"`
2. **Cargá movimientos con texto, audio o foto:**
   - **Gasto en cuenta principal:** `"Café 3500 hormiga"` o `"Verdulería 18k"`
   - **En cuotas con tarjeta:** `"Zapatillas 120k en 3 cuotas con Visa"`
   - **Compra compartida:** `"Regalo 44k en 3 cuotas con Visa, mitad de Ana"`
   - **Inversión / Transferencia:** `"Invertí 150k en ETF"` / `"Pasé 50k a Reservas"`
   - **Consultas:** `"¿Cuánto gasté en #hormiga este mes?"`, `/cuentas`, `/resumen`, `/saldos`, `/futuro`, `/ultimos`.
