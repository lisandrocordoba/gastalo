# Gasti Personal (Telegram + Gemini + Cloudflare Workers/D1 + PWA)

Asistente personal de finanzas 100% gratuito (\$0/mes) diseñado para el flujo argentino:
- **Mercado Pago** como cuenta principal, **MP Reservas**, **BBVA Crédito** (gastos en negativo + pago mensual como transferencia desde MP) y **Efectivo**.
- **Bot de Telegram con IA multimodal (`gemini-3.5-flash-lite`)**: entiende texto libre, notas de voz y fotos de tickets/comprobantes.
- **Dashboard Web (PWA + Telegram Mini App)**: saldos por cuenta, gráficos por categoría, evolución mensual de 6 meses, buscador, edición y exportación a CSV.

> 📘 **Documentación técnica y flujo de trabajo:** leé [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para entender la infraestructura en Cloudflare, los límites del plan gratuito (\$0/mes), las medidas de seguridad y la política de versionado (desarrollo local + deploy controlado solo desde `main`).  
> 📐 **Modelo de Datos v2 y Casos de Uso:** consultá [docs/MODELO_DATOS_V2.md](docs/MODELO_DATOS_V2.md) para el detalle de cuentas, categorías, etiquetas, cuotas, inversiones y manejo de gastos compartidos.

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

# Copiar variables de ejemplo para desarrollo local
cp .dev.vars.example .dev.vars
# Completar .dev.vars con tus claves

# Crear la base de datos local y aplicar migraciones
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
   Copiá el `database_id` que imprime y pegalo en `wrangler.toml`.
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
   *(Para `TELEGRAM_WEBHOOK_SECRET` y `DASHBOARD_TOKEN` podés inventar cualquier string largo aleatorio).*
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

## Cómo usarlo todos los días
- **Gasto común (va a Mercado Pago por defecto):** `"Café 3500"` o un audio `"Compré carne por 18 lucas"`
- **Efectivo:** `"8500 verdulería en efectivo"`
- **Tarjeta BBVA:** `"Farmacity 24000 con BBVA"` o `"Zapatillas 120k en 3 cuotas tarjeta"`
- **Reservas:** `"Pasé 150k a reservas"` / `"Saqué 40k de reservas"`
- **Pago de resumen BBVA:** `"Pagué la tarjeta 280000"` *(registra transferencia `MP → BBVA Crédito`)*
- **Fotos:** Sacá foto a un ticket o mandá captura de comprobante.
- **Consultas:** `"¿Cuánto gasté en comida este mes?"`, `/resumen`, `/saldos`, `/ultimos`.
