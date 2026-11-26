# Roadmap y Próximos Pasos — Gasti Personal

> **Estado base:** `v3.0` agnóstico desplegado en `main` + endurecimiento `v3.1` (`fix/filter-statement-attribution`, `fix/accounting-and-api-hardening`, `fix/security-telegram-and-hygiene`, `test/cobertura-integracion`).  
> **Documentos hermanos:** [Arquitectura e Infraestructura](ARQUITECTURA.md) · [Modelo de Datos y Casos de Uso](MODELO_DATOS.md) · [Plan de Evolución v3 Agnóstico](PLAN_V3_AGNOSTICO.md).

Este documento centraliza la estrategia de trabajo en ramas a partir de `v3.0`, el estado de las ramas de endurecimiento `v3.1` y el análisis técnico de las próximas funcionalidades planificadas.

---

## 0. Estado de Endurecimiento v3.1

| Rama | Foco | Estado / Alcance clave |
| :--- | :--- | :--- |
| **`fix/filter-statement-attribution`** | Atribución en filtros | Incorpora `paid_statement_items` y `referencedTransactions` en `/api/bootstrap` para que filtrar `TransactionList` por categoría/etiqueta coincida 100% con los gráficos bajo Opción B; normaliza `installments_total >= 2`. |
| **`fix/accounting-and-api-hardening`** | Contabilidad, D1 y API | Pagos parciales/múltiples de resumen (`pending` / `partial` / `paid`) con asignación cronológica acumulada; monedas acotadas a `ARS`/`USD`/`BRL`; snapshot único vía `db.batch`; `migrations/0002_indexes.sql`; validaciones API estrictas. |
| **`fix/security-telegram-and-hygiene`** | Seguridad y repo limpio | Autenticación *fail-closed* por defecto (`TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_TELEGRAM_USER_ID`, `DASHBOARD_TOKEN`, `auth_date` obligatorio y chats privados), deduplicación de webhook, `wrangler.toml` en `.gitignore`, limpieza de placeholders y alineación documental v3.1. |
| **`test/cobertura-integracion`** | Tests de integración | Ampliación de cobertura sobre endpoints Hono, webhook/callbacks de Telegram y flujos contables/seguridad. |

---

## 1. Estrategia de Versionado y Ramas (Git Flow Liviano)

A partir de `v3.0`, cada línea de trabajo vive en su propia rama corta, separada de `main`:

| Rama | Rol | Regla |
| :--- | :--- | :--- |
| **`main`** | **Producción.** Exactamente lo desplegado en Cloudflare Workers. | Nunca desarrollar directo en `main`. Solo recibe merges validados. |
| **`dev`** | **Integración estable.** Reúne features y fixes antes de publicar un release. | Siempre debe pasar `npm test` y `npm run build`. |
| **`feat/<nombre>`** | **Nuevas funcionalidades** (ej. `feat/grupos-personas`, `feat/auth-pin-login`, `feat/alertas-vencimiento-telegram`). | Nace de `main` (o `dev`), lleva migración numerada `migrations/000X_...sql` si toca esquema y tests unitarios. |
| **`test/<nombre>`** | **Ampliación de cobertura de tests** (ej. `test/cobertura-integracion`). | Solo agrega o mejora specs/fixtures sin mezclar cambios de features. |
| **`fix/<nombre>`** | **Correcciones puntuales** detectadas en local o producción. | Atómica y con test de regresión cuando aplique. |

### Checklist obligatorio antes de mergear a `main`
1. `npm test` y `npm run build` en verde (0 errores de TypeScript/Vite).
2. Si hubo cambios de esquema D1: archivo nuevo `migrations/000X_...sql` (próxima disponible: `0003_...sql`) probado primero en `--local` (`npm run db:migrate:local`) — **nunca** editar `0001_initial.sql` ni `0002_indexes.sql`.
3. `git status` y `git diff` revisados: sin archivos personales (`wrangler.toml`, `imports/`, `.dev.vars`, `.wrangler/`) ni nombres reales acoplados al código.
4. En release a producción: `git push`, `npm run db:migrate:remote` (si hay migración nueva) y `npm run deploy`.

---

## 2. Próximas Features y Evaluación Técnica

### Feature 1 — Agrupación y filtrado por Grupos / Personas (`feat/grupos-personas`)

#### Necesidad
Además de **Categorías** (qué tipo de gasto es: `Supermercado`, `Delivery`, `Salidas`) y **Etiquetas** (contexto transversal: `#hormiga`, `#casa`, `#vacaciones`), se busca poder **agregar y filtrar gastos por círculo o persona** (por ejemplo: *Pareja*, *Grupo Facultad*, *Amigos*, *Familia*) para responder *"¿cuánto gasté este mes con Amigos?"* o *"¿cuánto gasté en Salidas con mi Pareja?"*.

#### Evaluación de modelado: ¿Etiquetas (`tags`) vs. Entidad dedicada (`groups`)?

| Enfoque | Ventajas | Desventajas | Veredicto |
| :--- | :--- | :--- | :--- |
| **A. Reutilizar `tags` tal cual** | Cero cambios de esquema; ya soporta N:M y ranking en Dashboard. | Mezcla dimensiones distintas (hábitos/proyectos `#hormiga`/`#vacaciones` con personas/grupos), ensucia porcentajes y complica consultas cruzadas (*Categoría + Hábito + Grupo*). | No recomendado a largo plazo |
| **B. Reutilizar `tags` con discriminador `kind` (`'topic' \| 'group'`)** | Aprovecha `tags` y `transaction_tags` existentes agregando solo una columna. | Sigue exponiendo grupos como `#tags` en CSV/consultas si no se separan bien; en N:M un gasto asignado a 2 grupos duplicaría la suma si se suman totales sin cuidado. | Viable, pero acoplado |
| **C. Entidad dedicada `groups` + `transactions.group_id` (1:N opcional)** | Semántica limpia y ortogonal (`Categoría` × `Etiqueta` × `Grupo`); **cero doble conteo** en agregaciones; permite filtro combinado en Dashboard y Telegram; `third_party_name` sigue reservado para deuda cobrable (`third_party`). | Requiere nueva migración (`0003_groups.sql`), CRUD en API/Settings y campo nuevo en formularios/Gemini. | **Recomendado** |

> *(Nota: si en algún caso real un mismo gasto necesitara asignarse a más de un grupo simultáneamente, puede usarse una tabla N:M `transaction_groups` en lugar de `group_id`; de lo contrario, `group_id` 1:N mantiene las sumas exactas y las queries más simples).*

#### Alcance sugerido en `feat/grupos-personas`
- Migración `0003_groups.sql`: tabla `groups (id, name, icon, color, created_at)` + columna `group_id TEXT REFERENCES groups(id)` + índice en `transactions`.
- CRUD completo `/api/groups` + soporte `intent: 'manage'` en Gemini/Telegram.
- Panel **Gastos por grupo / persona** en Dashboard + selector en `TransactionModal` y filtro cruzado en `TransactionList`.

---

### Feature 2 — Acceso al Dashboard fuera de casa (`feat/auth-pin-login`)

#### Problema
Hoy el Dashboard en navegador exige `DASHBOARD_TOKEN` (un secreto largo pensado para `.dev.vars` y Cloudflare Secrets). Fuera de casa o desde un dispositivo nuevo sin Telegram abierto, resulta incómodo o imposible copiar ese token.

#### Opciones de diseño recomendadas
1. **Contraseña o PIN personal + Cookie de sesión (`HttpOnly`, `Secure`, `SameSite=Lax`):**
   - Definir un secreto `DASHBOARD_PIN_HASH` (derivado con PBKDF2/Web Crypto en `src/auth.ts`) o contraseña memorable.
   - Al iniciar sesión desde `/api/auth/login`, el Worker valida con comparación en tiempo constante (más un contador simple de intentos fallidos / cooldown en D1 para frenar fuerza bruta) y emite una cookie firmada con HMAC-SHA256 válida por N días.
2. **Magic Link temporal desde el Bot de Telegram (`/login`):**
   - Al escribir `/login` en el chat autorizado (`ALLOWED_TELEGRAM_USER_ID`), el bot genera un token efímero (expira en ~5 minutos, 1 solo uso) guardado en D1 y devuelve un enlace directo `https://<worker>/?magic=...` que inicia sesión en cualquier navegador al instante sin recordar nada.
3. **Convivencia:** mantener `X-Telegram-Init-Data` (Mini App) + `Authorization: Bearer <DASHBOARD_TOKEN>` (para scripts) y sumar **PIN/Contraseña + `/login` por Telegram** como acceso diario.

---

### Feature 3 — Alertas proactivas de vencimiento de TC en Telegram (`feat/alertas-vencimiento-telegram`)

#### Necesidad
Hoy el bot informa resúmenes vencidos cuando consultás (`/saldos`, `/resumen` o preguntas libres). El objetivo es que **Telegram te avise proactivamente** cuando una tarjeta está por vencer o ya venció sin pagarse.

#### Diseño técnico en Cloudflare Workers ($0/mes)
- **Cloudflare Cron Triggers** (`[triggers]` en `wrangler.toml`, ej. `crons = ["0 12 * * *"]` → 09:00 `America/Argentina/Buenos_Aires`, incluido gratis en Free Tier) conectado al handler `scheduled()` en `src/index.ts`.
- En cada corrida diaria:
  1. Reutiliza `computeCardStatements` (con `todayInTimezone(tz)`) para evaluar todas las tarjetas con `due_day` configurado y `status === 'pending'` con `total_due > 0`.
  2. Dispara mensaje a `ALLOWED_TELEGRAM_USER_ID` en ventanas claras (por ejemplo: **3 días antes**, **el día del vencimiento** y **primer día vencido**), incluyendo botón directo para abrir el Dashboard (`web_app`).
  3. Guarda en D1 (tabla simple de log o columna en alerta) la última notificación enviada por `(account_id, statement_month, level)` para garantizar **idempotencia** y no repetir el mismo aviso cada día.

---

### Línea paralela — Ampliación de Tests (`test/cobertura-integracion`)

- Tests de integración contra `app.request(...)` de Hono (validaciones 400/401/409, flujo completo `createAccount → createTransaction → payCardStatement → bootstrap`).
- Tests del webhook de Telegram y callbacks inline (`tgCall` mockeado con `vi.stubGlobal('fetch', ...)`).
- Tests de componentes React críticos (`RecurringModal`, `CreditCardsSection`, `TransactionModal`) con Testing Library.
