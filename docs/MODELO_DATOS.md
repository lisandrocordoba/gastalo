# Especificación del Modelo de Datos v3.1 y Guía de Casos de Uso

> **Estado:** Modelo v3.1 agnóstico endurecido sobre v3.0 (`main`).  
> **Documentos hermanos:** [Arquitectura e Infraestructura](ARQUITECTURA.md) · [Plan de Evolución v3 Agnóstico](PLAN_V3_AGNOSTICO.md) · [Roadmap y Próximos Pasos](ROADMAP.md).

Este documento describe el modelo contable y de datos definido en [`migrations/0001_initial.sql`](../migrations/0001_initial.sql) y [`migrations/0002_indexes.sql`](../migrations/0002_indexes.sql), diseñado para funcionar de forma **agnóstica** con cualquier combinación de bancos, billeteras digitales, cuentas de ahorro, efectivo y tarjetas de crédito en las monedas soportadas (`ARS`, `USD` y `BRL`).

---

## 1. Principios de Diseño

1. **Arranque vacío ("Zero-account start"):** una instancia nueva inicia con **0 cuentas** y **0 movimientos**. Cada usuario crea sus cuentas y tarjetas desde el Dashboard Web (`+ Nueva cuenta`, `+ Nueva tarjeta`, `⚙️ Configurar`) o por Telegram (`"Creá cuenta..."`, `/cuentas`).
2. **Categorías planas, limpias y editables:** arranca con **18 categorías de gasto + 4 de ingreso**, todas personalizables (nombre, ícono, tipo y color) desde la interfaz o por chat.
3. **Separación clara entre consumo doméstico, delivery y salidas:** distingue `Supermercado`, `Servicios` (hogar), `Delivery` (comida al paso / almuerzo laboral / delivery), `Salidas / Social` (planes sociales), `Kiosco`, `Compras` vs `Ropa`, y `Suscripciones` (asociables también a tarjetas de crédito).
4. **Mes contable opcional (`budget_month`):** si cobrás a fin de mes (ej. el `29/10` para cubrir noviembre), podés imputar el sueldo al mes siguiente en KPIs y gráficos sin alterar la fecha bancaria real (`occurred_at`) ni el saldo actual.
5. **Etiquetas transversales (`tags`, relación N:M):** permiten cruzar categorías para responder preguntas como *"¿cuánto gasté en `#vacaciones`?"* o *"¿cuánto ahorraría evitando gastos `#hormiga`?"*.
6. **Contabilidad de doble entrada sin distorsiones (Opción B):**
   - Los consumos con **tarjeta de crédito** acumulan deuda real en la tarjeta al instante, pero **no** entran en los gastos de consumo del período hasta que se registra el pago del resumen desde una cuenta líquida (`transfer` con `statement_month`).
   - Las transferencias internas entre cuentas propias nunca suman como gasto ni ingreso.
   - Tanto las **inversiones** (`investment`) como los **gastos por cuenta de terceros** (`third_party` / `third_party_repayment`) tienen tipos dedicados.
7. **Proyección hacia adelante:** seguimiento estructurado de **cuotas** en tarjeta y **gastos fijos mensuales** (`recurring_items`, con mes de inicio `start_month` para evitar mostrar suscripciones en resúmenes o meses anteriores y elegir el primer resumen al asociarlos a una tarjeta) comparados contra el saldo acumulado en tus cuentas de tipo `savings` (ahorros / reservas).

---

## 2. Cuentas y Tarjetas (`accounts`)

Cada cuenta creada por el usuario tiene:
- `id`: identificador slug único autogenerado (ej. `billetera`, `banco_galicia`, `visa_usd`).
- `name`: nombre visible elegido por el usuario.
- `type`: uno de los 4 tipos soportados:
  - **`wallet`**: billetera digital o cuenta bancaria corriente/sueldo (puede marcarse con `is_default = 1`).
  - **`savings`**: cuenta de ahorro, reservas o fondo separado (usada para cobertura de cuotas y gastos fijos futuros).
  - **`cash`**: efectivo.
  - **`credit_card`**: tarjeta de crédito (moneda `ARS`, `USD` o `BRL`; saldo acumulado negativo hasta pagar el resumen; nunca se marca `is_default = 1`).
- `currency`: código de moneda estrictamente acotado a `ARS` (`$`), `USD` (`US$`) o `BRL` (`R$`), validado en API, motor contable, Gemini y UI.
- `initial_balance`: saldo inicial configurable.
- `color`: color hexadecimal personalizable para distinguir cuentas en tarjetas y badges de movimientos.
- `due_day`: *(opcional, `1–31`, solo para `credit_card`)* día de vencimiento del resumen mensual para mostrar alertas cuando un resumen pendiente está vencido.

---

## 3. Base Genérica Inicial de Categorías y Etiquetas

*(Todas son editables y eliminables desde `⚙️ Configurar` siempre que no tengan movimientos vinculados en el caso de categorías).*

### A. Categorías de Gasto (18)
| ID (`slug`) | Ícono + Nombre | Ejemplos de uso |
| :--- | :--- | :--- |
| `supermercado` | 🛒 Supermercado | Compras para abastecer el hogar: supermercado, almacén, carnicería, verdulería. |
| `servicios` | 💡 Servicios | Gastos fijos del hogar: luz, agua, gas, internet/wifi, expensas. |
| `mascotas` | 🐾 Mascotas | Alimento, veterinaria, accesorios. |
| `delivery` | 🍔 Delivery | Pedidos de delivery, viandas, almuerzos de trabajo o comida al paso. |
| `kiosco` | 🍫 Kiosco | Snacks, gaseosas, café al paso, golosinas, helado. |
| `compras` | 🛍️ Compras | Electrónica, artículos del hogar, herramientas, bazar. |
| `ropa` | 👕 Ropa | Indumentaria, calzado, accesorios de vestir. |
| `regalos` | 🎁 Regalos | Cumpleaños, aniversarios, obsequios. |
| `cuidado_personal` | 💇 Cuidado personal | Peluquería, higiene personal, estética. |
| `transporte_publico` | 🚌 Transporte público | Colectivo, subte, tren, tarjeta de transporte. |
| `uber_taxi` | 🚕 Uber / Taxi | Viajes en apps de movilidad o taxi. |
| `auto` | 🚗 Auto | Combustible, estacionamiento, patente, peajes, mantenimiento. |
| `salidas_social` | 🥂 Salidas / Social | Juntadas, cine, recitales, salidas con amigos o pareja. |
| `deporte` | ⚽ Deporte / Fitness | Gimnasio, alquiler de cancha, actividades deportivas. |
| `educacion` | 📚 Educación | Cursos, libros, clases, capacitaciones. |
| `salud` | 💊 Salud | Médico, farmacia, estudios, odontología. |
| `suscripciones` | 📱 Suscripciones | Apps, streaming, telefonía móvil, membresías digitales. |
| `otros` | 📦 Otros / Trámites | Trámites, comisiones bancarias, imprevistos menores. |

### B. Categorías de Ingreso (4)
| ID (`slug`) | Ícono + Nombre | Ejemplos de uso |
| :--- | :--- | :--- |
| `sueldo` | 💼 Sueldo / Trabajo | Haberes mensuales, honorarios, aguinaldo, freelance. |
| `rendimientos` | 📈 Rendimientos | Intereses de billeteras, plazos fijos, rendimientos diarios. |
| `reintegros` | 🔄 Reintegros | Promociones bancarias, devoluciones, cashback. |
| `otros_ingresos` | 💰 Otros ingresos | Ventas puntuales, regalos recibidos, otros ingresos. |

### C. Etiquetas Base (`tags`, N:M)
- `#casa`, `#hormiga`, `#familia`, `#vacaciones`, `#emergencia` *(podés crear, editar y borrar libremente)*.

---

## 4. Tipos de Movimiento y Regla Contable (Opción B)

1. `expense` — Gasto de consumo personal.
2. `income` — Ingreso personal real.
3. `transfer` — Movimiento interno entre 2 cuentas propias (`account_id → to_account_id`).
4. `investment` — Salida de capital hacia inversión (`CEDEARs`, `ETF`, `BTC`, etc.).
5. `third_party` — Pago realizado por cuenta de otra persona (o su porción en una compra compartida).
6. `third_party_repayment` — Dinero recibido de un tercero para saldar un `third_party` previo.
7. `adjustment` — Conciliación manual de saldo real (`⚖️`).

### Tabla de impacto por tipo

| `type` | Saldo `account_id` | Saldo `to_account_id` | Gastos consumo (`cash`) | Compras con TC | Ingresos | Invertido | Terceros (por cobrar) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `expense` (cuenta líquida) | `- amount` | — | `+ amount` | `0` | `0` | `0` | `0` |
| `expense` (`credit_card`) | `- amount` | — | `0` *(al pagar resumen)* | `+ amount` | `0` | `0` | `0` |
| `income` | `+ amount` | — | `0` | `0` | `+ amount` | `0` | `0` |
| `transfer` (entre líquidas) | `- amount` | `+ amount` | `0` | `0` | `0` | `0` | `0` |
| `transfer` (`líquida → credit_card`) | `- amount` | `+ amount` | `+ own_paid` *(desglosado por ítems del resumen)* | `0` | `0` | `0` | `0` |
| `investment` | `- amount` | — | `0` | `0` | `0` | `+ amount` | `0` |
| `third_party` | `- amount` | — | `0` | `0` *(en resumen como ajeno)* | `0` | `0` | `+ amount` |
| `third_party_repayment` | `+ amount` | — | `0` | `0` | `0` | `0` | `- amount` |
| `adjustment` | `± amount` | — | `0` | `0` | `0` | `0` | `0` |

### Reglas Contables e Índices Endurecidos (v3.1)

1. **Pagos parciales y múltiples de resumen (`status: 'pending' | 'partial' | 'paid'`):**
   - Varias transferencias hacia la misma `(credit_card, statement_month)` se agregan cronológicamente (`occurred_at`, `created_at`, `id`).
   - Cada pago absorbe primero el saldo pendiente ajeno (`third_party_total`) y luego prorratea el excedente sobre la porción propia (`own_total`), evitando descontar dos veces gastos de terceros o apagar alertas `is_overdue` antes de cancelar `total_due` (`remaining_due`).
2. **Atribución en filtros (`paid_statement_items` y `referencedTransactions`):**
   - Al pagar un resumen en el período actual, `/api/bootstrap` calcula `paid_statement_items` (ítems propios prorrateados efectivamente cubiertos) y adjunta `referencedTransactions` (las compras originales de meses previos o cuotas que no caen en el rango calendario del período) para que filtrar `TransactionList` por categoría o etiqueta coincida exactamente con los gráficos.
3. **Normalización de cuotas (`installments_total >= 2`):**
   - Solo se consideran compras en cuotas cuando `installments_total >= 2` (`expense` o `third_party`). Valores `< 2` o `1` se normalizan a `null` junto con `first_installment_month = null`, evitando tratar pagos en 1 cuota como planes de cuotas en resúmenes o proyecciones.
4. **Índices D1 adicionales ([`migrations/0002_indexes.sql`](../migrations/0002_indexes.sql)):**
   - `idx_transactions_to_account_id`: acelera consultas y validación de integridad referencial sobre cuentas destino (`transfer`).
   - `idx_recurring_items_account_id`: acelera el chequeo de referencias al editar/eliminar cuentas.
   - `idx_transactions_telegram_message_id`: índice parcial para deduplicar reintentos del webhook de Telegram sin escanear toda la tabla.

---

## 5. Casos de Uso Representativos

### Caso 1: Compra compartida en cuotas con reembolso inmediato
Comprás un regalo de **\$44.000** en **3 cuotas** con tu tarjeta de crédito a medias con **Ana**. Ana te transfiere hoy **\$22.000** a tu cuenta principal.
1. Registrás en el bot o Web: *"Regalo 44000 en 3 cuotas tarjeta, mitad de Ana"*.
   - Se crean 2 registros vinculados (`linked_group_id`): `expense` de \$22.000 (3 cuotas) + `third_party` de \$22.000 a nombre de `Ana` (3 cuotas).
2. Cuando Ana te transfiere: *"Ana me transfirió 22000 por el regalo"* → `third_party_repayment` de \$22.000.
   - Si tenés creada una cuenta `savings` (ej. *Reservas*), Telegram ofrece `[🛡️ Pasar a Reservas]` para apartar esa plata de tu saldo disponible sin ensuciar tus métricas.
3. Al pagar el resumen de la tarjeta mes a mes desde el botón **`💳 Pagar resumen`**, solo tu parte propia (\$7.333,33) entra en `Gastos consumo` dentro de la categoría `Regalos`; la parte ajena reduce deuda sin inflar tu gasto personal.

### Caso 2: Inversiones y proyecciones futuras
- *"Invertí 150k en ETF SPY"* → registra `investment`, descuenta tu cuenta líquida y suma en el KPI **Invertido**, sin mezclarse con tus gastos de consumo.
- La tarjeta **Próximos meses** suma todas las cuotas activas + tus gastos fijos (`recurring_items`) y las compara contra la suma de tus cuentas `type = 'savings'`.

### Caso 3: Conciliación rápida de saldo (`⚖️`)
Si tu saldo real en una cuenta difiere por unos pesos, tocás `⚖️` sobre la tarjeta de la cuenta, ingresás el saldo real y el sistema genera automáticamente un `adjustment` por la diferencia exacta sin distorsionar gráficos ni balances mensuales.

---

## 6. Decisiones y Evolución de Invariantes (v3.1)

1. **Monedas acotadas estrictamente a `ARS`, `USD`, `BRL` (`$`, `US$`, `R$`):**
   - *Por qué:* docs previos y `AccountModal` mencionaban "otras monedas" (`EUR`, `CLP`, `UYU`, `MXN`) mientras el motor contable y Gemini solo procesaban `ARS` y `USD`, descartando silenciosamente el resto o mezclando monedas en saldos. Se acota explícitamente a `ARS`/`USD`/`BRL` con validación en API, DB, Gemini y UI para garantizar integridad contable real.
2. **Atribución de resúmenes pagados en `TransactionList` (`paid_statement_items`):**
   - *Por qué:* mantiene intacta la contabilidad `cash` (Opción B: el consumo entra al pagar el resumen), pero incorpora `paid_statement_items` y `referencedTransactions` en `/api/bootstrap` para que filtrar por categoría o etiqueta muestre los ítems de meses previos/cuotas pagados en el período y coincida 100% con los gráficos (resolviendo el bug de `Movimientos (0)`).
3. **Pagos parciales y múltiples de resumen (`pending` / `partial` / `paid`):**
   - *Por qué:* reemplaza la suposición previa de "1 transferencia = resumen pagado" por agregación cronológica acumulada por `(tarjeta, statement_month)`, evitando que un pago parcial borre alertas vencidas o descuente dos veces `third_party_total`.
4. **Seguridad *fail-closed* por defecto:**
   - *Por qué:* `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_TELEGRAM_USER_ID`, `DASHBOARD_TOKEN`, `auth_date` obligatorio en Mini App `initData` y chats privados (`chat.id === allowedId`) pasan a ser obligatorios con comparación en tiempo constante vía SHA-256, impidiendo exposición accidental por variables faltantes.
5. **`wrangler.toml` excluido de Git:**
   - *Por qué:* resuelve la contradicción entre el `README.md` y el repositorio trackeado, blindando la Invariante #1 (sin `database_id` ni dominios personales en Git).
