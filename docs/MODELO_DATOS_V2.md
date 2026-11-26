# Especificación del Modelo de Datos v2 y Guía de Casos de Uso

> **Estado:** Planificación aprobada (Etapa 2.1) — en rama `dev`.  
> **Documento hermano:** [Arquitectura e Infraestructura](ARQUITECTURA.md).

Este documento define la evolución del modelo de datos desde el MVP v1 ([`migrations/0001_initial.sql`](../migrations/0001_initial.sql)) hacia la **v2**, diseñada a partir del análisis real de **2.362 registros** exportados de *Wallet by BudgetBakers* (`2022-01` a `2026-06`).

---

## 1. Principios de Diseño

1. **Categorías planas y limpias (sin subcategorías):** se elimina el exceso y solapamiento de Wallet (~45 categorías) y se reemplaza por **16 categorías de gasto + 4 de ingreso**.
2. **Separación justa de la comida:** no se mezcla abastecer la casa (`Supermercado`) con almuerzos/delivery (`Comida afuera / Delivery`) ni con consumos evitables (`Kiosco / Café / Snacks`).
3. **Etiquetas transversales (`tags`, relación N:M):** permiten cruzar cualquier categoría para responder preguntas reales como *"¿cuánto destino a `#casa` en total?"* o *"¿cuánto ahorraría sin gastos `#hormiga`?"*.
4. **Contabilidad de doble entrada sin ruido:** los consumos con tarjeta dejan la cuenta en negativo, las transferencias internas (`MP ↔ MP Reservas`, `MP ↔ Efectivo`, `MP → TC BBVA`) nunca suman como gasto ni ingreso, y tanto las **inversiones** como los **gastos de terceros** tienen tipos dedicados para no distorsionar tus métricas mensuales.
5. **Visibilidad hacia adelante:** soporte estructurado de **cuotas** en tarjeta y **gastos fijos mensuales** para compararlos contra el saldo real en `MP Reservas`.

---

## 2. Cuentas Definitivas (6)

Se elimina la restricción de 3 cuentas de la versión gratuita de Wallet:

| ID | Nombre | Tipo (`type`) | Moneda | Rol en tu flujo |
| :--- | :--- | :--- | :---: | :--- |
| `mp` | **Mercado Pago** | `wallet` | `ARS` | Cuenta principal por defecto (disponible real para gastar). |
| `mp_reservas` | **MP Reservas** | `savings` | `ARS` | Dinero reservado en MP para el mes próximo, cuotas futuras o imprevistos. |
| `efectivo` | **Efectivo** | `cash` | `ARS` | Plata en mano. |
| `bbva_credito` | **TC BBVA** | `credit_card` | `ARS` | Consumos en pesos con tarjeta de crédito BBVA (saldo negativo hasta pagar el resumen). |
| `bbva_credito_usd` | **TC BBVA USD** | `credit_card` | `USD` | Consumos en dólares con TC BBVA (ej. suscripciones/apps en USD sin mezclar monedas). |
| `mp_credito` | **TC MP** | `credit_card` | `ARS` | Tarjeta de crédito de Mercado Pago (misma lógica de saldo negativo y pago por transferencia). |

---

## 3. Categorías y Etiquetas Iniciales

### A. Categorías de Gasto (16)

| ID (`slug`) | Ícono + Nombre | Qué incluye (ejemplos reales) |
| :--- | :--- | :--- |
| `supermercado` | 🛒 Supermercado | Compras para abastecer la casa: chino, super, carnicería, verdulería, huevos. |
| `comida_afuera` | 🍔 Comida afuera / Delivery | Almuerzos en el trabajo, hamburguesas, pizza, empanadas, restaurantes, delivery. |
| `kiosco_cafe` | 🍫 Kiosco / Café / Snacks | Alfajores, gaseosas, agua, facturas, café al paso, helado. |
| `salidas_social` | 🥂 Salidas / Social | Juntadas, previas, fiestas, boliches, entradas, cine, salidas en pareja/amigos. |
| `deporte` | ⚽ Deporte / Fitness | Alquiler de cancha/partidos, gimnasio, indumentaria/accesorios deportivos puntuales. |
| `uber_taxi` | 🚕 Uber / Taxi | Viajes en Uber, Cabify, DiDi, taxi. |
| `transporte_publico` | 🚌 Transporte público | Carga SUBE, colectivo, subte, tren. |
| `auto` | 🚗 Auto | Nafta, estacionamiento, garage/trapito, patente, lavado, mantenimiento. |
| `servicios` | 💡 Servicios | Gastos de la casa: luz, agua, gas, internet/wifi, expensas. |
| `suscripciones` | 📱 Suscripciones | Apps y servicios personales: Spotify, YouTube Premium, Google AI, Nivel 6 ML, GamePass, Tuenti. |
| `educacion` | 📚 Educación | Clases de inglés, libros, cursos, papelería/fotocopias. |
| `salud` | 💊 Salud | Médico, odontología, farmacia, remedios, kinesiología. |
| `cuidado_personal` | 💇 Cuidado personal | Peluquería, desodorantes, higiene personal. |
| `regalos` | 🎁 Regalos | Cumpleaños, aniversarios, Día del Padre/Madre, flores. |
| `compras_ropa` | 🛍️ Compras y Ropa | Ropa, zapatillas, electrónica personal, herramientas, artículos del hogar. |
| `mascotas` | 🐾 Mascotas | Comida para gatos, veterinaria. |
| `otros` | 📦 Otros / Trámites | Trámites (DNI, licencia), comisiones bancarias, imprevistos menores. |

### B. Categorías de Ingreso (4)

| ID (`slug`) | Ícono + Nombre | Qué incluye |
| :--- | :--- | :--- |
| `sueldo` | 💼 Sueldo / Trabajo | Sueldo mensual (Teckdes), aguinaldo, adelantos, trabajos extra. |
| `rendimientos` | 📈 Rendimientos | Intereses mensuales de Mercado Pago (o billeteras). |
| `reintegros` | 🔄 Reintegros | Reintegros de subte/transporte, Cuenta DNI, promociones. |
| `otros_ingresos` | 💰 Otros ingresos | Ventas puntuales (ej. hardware), regalos en dinero, ingresos varios. |

### C. Etiquetas Iniciales (`tags`, N:M)

Un movimiento puede tener **0, 1 o varias** etiquetas:

| Tag | Uso principal |
| :--- | :--- |
| `#casa` | Todo gasto destinado al hogar (super, carnicería, arreglos, nafta/patente compartida). |
| `#hormiga` | Gastos chicos evitables o impulsivos (kiosco, café, Uber corto, snacks). |
| `#abril` | Salidas, comidas, Uber, regalos o viajes compartidos con Abril. |
| `#familia` | Comidas, meriendas, salidas o compras con/para familia. |
| `#vacaciones` | Viajes y escapadas (agrupa comida, transporte, compras y salidas del viaje). |
| `#emergencia` | Imprevistos médicos, urgencias o roturas. |
| `#hw` | Compras y ventas puntuales de hardware/arreglos de PC (para medir resultado neto sin ensuciar gastos personales). |

---

## 4. Esquema de Base de Datos D1 (Propuesta `migrations/0002_v2_model.sql`)

### Nuevos tipos de movimiento (`transactions.type`)
1. `expense` — Gasto de consumo personal.
2. `income` — Ingreso personal real.
3. `transfer` — Movimiento interno entre 2 cuentas propias (`account_id → to_account_id`).
4. `investment` — Salida de dinero hacia inversión (`BTC`, `SPY`, `USD MEP`, `USDT`).
5. `third_party` — Pago realizado por cuenta de un tercero (o la porción del tercero en una compra compartida).
6. `third_party_repayment` — Dinero que un tercero te transfiere para saldar un `third_party` previo.
7. `adjustment` — Conciliación manual de saldo real (reemplaza a *Faltante / Arreglo de diferencia*).

### Nuevas columnas en `transactions`
- `installments_total INTEGER` (nullable): cantidad total de cuotas en compras con tarjeta (ej. `3`, `6`, `12`).
- `first_installment_month TEXT` (nullable): mes `YYYY-MM` en que impacta la primera cuota en el resumen.
- `third_party_name TEXT` (nullable): nombre del tercero involucrado (ej. `"Jere"`, `"Carlos"`, `"Mamá"`).
- `linked_group_id TEXT` (nullable): UUID corto para vincular la parte propia (`expense`) con la parte ajena (`third_party`) de una misma compra compartida.

### Nuevas tablas
- **`tags`**: `(id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL)`
- **`transaction_tags`**: `(transaction_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (transaction_id, tag_id))`
- **`recurring_items`**: `(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('expense','income')), amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'ARS', account_id TEXT NOT NULL, category_id TEXT, day_of_month INTEGER, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`

### Regla exacta de impacto contable por `type` (Opción B — Flujo Real de Pago TC)

1. **Tarjetas de Crédito como entidad propia:** `TC BBVA`, `TC BBVA USD` y `TC MP` registran la **deuda total real** al instante de pasar el plástico (ej. Dentista `-$632.640` en 6 cuotas).
2. **Invariante de flujo real (`basis = 'cash'`, por defecto):**
   - Mientras un resumen de tarjeta está **`⏳ Pendiente`**, la plata sigue en `Mercado Pago`, la deuda sigue en la tarjeta y el gasto **todavía no impacta** en los Gastos del Mes.
   - El día en que registrás el pago del resumen desde `Mercado Pago` (`[💳 Registrar pago resumen YYYY-MM]`), ese único pago (`transfer MP → TC` con `statement_month`) descuenta tu saldo de `MP`, descuenta tu deuda de `TC`, marca el resumen como **`✅ Pagado`** e imputa el monto pagado a los gastos de ese mes **desglosado por las categorías de las cuotas incluidas** (excluyendo porciones `third_party`).
   - Se mantiene un selector opcional `Compra total (Devengado)` en el Dashboard para auditar compras en su fecha original.

| `type` | Saldo `account_id` | Saldo `to_account_id` | Gastos consumo (`cash`) | Ingresos | Invertido | Saldo terceros (por cobrar) | Cuotas / Resumen TC |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `expense` (en cuenta líquida) | `- amount` | — | `+ amount` | `0` | `0` | `0` | — |
| `expense` (en `credit_card`) | `- amount` | — | `0` *(impacta al pagar resumen)* | `0` | `0` | `0` | Sí (`1..N` cuotas) |
| `income` | `+ amount` | — | `0` | `+ amount` | `0` | `0` | — |
| `transfer` (entre cuentas líquidas) | `- amount` | `+ amount` | `0` | `0` | `0` | `0` | — |
| `transfer` (`MP → credit_card`) | `- amount` | `+ amount` | `+ own_paid` *(desglosado por cuotas del resumen)* | `0` | `0` | `0` | Marca resumen `paid` |
| `investment` | `- amount` | — | `0` | `0` | `+ amount` | `0` | — |
| `third_party` | `- amount` | — | `0` | `0` | `0` | `+ amount` *(te deben)* | Sí (en TC suma al total a pagar al banco) |
| `third_party_repayment` | `+ amount` | — | `0` | `0` | `0` | `- amount` *(saldado)* | — |
| `adjustment` | `± amount` | — | `0` | `0` | `0` | `0` | — |

---

## 5. Guía de Casos de Uso y Edge Cases (Manual de Referencia)

Esta sección documenta exactamente cómo registrar y resolver los escenarios no triviales del día a día.

### Caso 1: Compra compartida en cuotas con reembolso inmediato
**Escenario real:** Comprás un regalo de **\$44.000** en **3 cuotas** con **TC BBVA** a medias con Jere. Jere te transfiere hoy **\$22.000** a Mercado Pago. Esa plata no es tuya para gastar este mes: tiene que quedar guardada para cubrir las 3 cuotas futuras del resumen.

#### Paso a paso
1. **Registrás la compra en el bot:**
   > *"Compré crocs regalo papá por 44000 en 3 cuotas con BBVA, mitad de Jere"*
   - El bot genera **2 registros vinculados** (`linked_group_id` compartido) en `bbva_credito`:
     - Registro A: `type = expense`, `amount = 22000`, `category = regalos`, `installments_total = 3` → *"Crocs regalo papá (mi parte)"*.
     - Registro B: `type = third_party`, `amount = 22000`, `third_party_name = "Jere"`, `installments_total = 3` → *"Crocs regalo papá (parte Jere)"*.
2. **Cuando Jere te transfiere los \$22.000 a Mercado Pago:**
   > *"Jere me transfirió 22000 por el regalo"*
   - El bot registra en `mp`:
     - `type = third_party_repayment`, `amount = 22000`, `third_party_name = "Jere"`.
   - En ese mismo mensaje, el bot detecta que es un reembolso de tercero y te ofrece el botón rápido: **`[🛡️ Pasar \$22.000 a Reservas]`**.
3. **Al tocar `[🛡️ Pasar a Reservas]` (o cuando lo hacés en la app de MP):**
   - Se registra `type = transfer`, `amount = 22000`, `mp → mp_reservas`.
4. **Cuando cierra el resumen mensual (ej. 1/3 de \$44.000 = \$14.666):**
   - Sacás tu cuota de reservas (o pagás directo desde `mp`): `transfer mp_reservas → mp` (si la habías reservado) y `transfer mp → bbva_credito`.

#### Cómo quedan tus números (100% consistentes)
- **Gasto del mes en Regalos:** **\$22.000** (solo tu mitad real).
- **Ingresos del mes:** **\$0** extra (no se infla tu sueldo).
- **Saldo de `TC BBVA`:** **-\$44.000** (coincide exacto con el banco).
- **Proyección de cuotas futuras:** **\$14.666/mes** durante 3 meses (coincide exacto con el resumen a pagar).
- **Disponible real en `MP`:** intacto (los \$22.000 de Jere pasaron a `MP Reservas`).
- **Pendiente de terceros (Jere):** **\$0** (saldado).

---

### Caso 2: Compra 100% para un tercero (sin participación tuya)
**Escenario real:** Pagás con tu tarjeta (ej. `TC MP`) un regalo o compra ajena por **\$109.341** que después te transfieren completo a `Mercado Pago`.

1. **Compra:** *"Pagué 109341 en TC MP por un inflador para Carlos, me lo devuelve"* → `type = third_party`, `amount = 109341`, `account = mp_credito`, `third_party_name = "Carlos"`.
2. **Devolución:** *"Carlos me transfirió 109000"* → `type = third_party_repayment`, `amount = 109000`, `account = mp`, `third_party_name = "Carlos"` (+ sugerencia de pasarlo a `MP Reservas` si la compra fue a tarjeta).
- **Resultado:** \$0 en tus gastos, \$0 en tus ingresos, deuda real en `TC MP` y saldo real en `MP`.

---

### Caso 3: Pago en efectivo por otro / familia con devolución a Mercado Pago
**Escenario real:** Pagás la carnicería de tu casa en **Efectivo** (\$31.950) y tu mamá te transfiere los \$31.950 a **Mercado Pago**.

- **Cómo se registra:** como una sola transferencia interna:
  > *"Transferí 31950 de efectivo a MP por carnicería casa"*
  - `type = transfer`, `account_id = efectivo`, `to_account_id = mp`, tag opcional `#casa`.
- **Por qué:** el gasto económico real fue de tu madre (no tuyo), y en tu patrimonio simplemente salió plata de `Efectivo` y entró a `Mercado Pago`.

---

### Caso 4: Inversiones (`BTC`, `SPY`, `USD MEP`)
**Escenario real:** Comprás \$150.000 de BTC o \$95.000 de SPY usando plata de Mercado Pago (y llevás el detalle de tenencia en tu Google Sheets).

- **Cómo se registra:** *"Invertí 150k en BTC"* → `type = investment`, `amount = 150000`, `account_id = mp`, `description = "Compra BTC"`.
- **Impacto:** descuenta \$150.000 de `Mercado Pago`, **no** entra en el gráfico de gastos de consumo, y suma en la métrica **"Invertido del mes"**.
- **Si vendés una inversión y vuelve a MP:** se registra como `income` (o futura sección Inversiones cuando incorporemos cartera propia).

---

### Caso 5: Proyección de próximo mes (`Cuotas + Fijos vs. MP Reservas`)
1. Cargás tus gastos fijos mensuales una sola vez en `recurring_items` (Spotify, YouTube, Tuenti, Nivel 6 ML, Inglés, Gimnasio, Peluquería, Comida gatos).
2. Cada compra en cuotas en `TC BBVA` o `TC MP` guarda `installments_total` y `first_installment_month`.
3. El comando `/futuro` (y la tarjeta "Próximo Mes" en el Dashboard) suma:
   - `Cuotas activas que vencen el próximo mes` + `Gastos fijos activos`
   - Y te muestra la diferencia contra tu saldo actual de **`MP Reservas`** (`Cubierto` o `Falta reservar $ X`).

---

### Caso 6: Conciliación de saldo (reemplazo de "Faltante / Arreglo de diferencia")
Si después de 2 semanas hay una pequeña diferencia entre tu billetera real y el saldo calculado en la app:
- Desde el Dashboard (botón **"Conciliar saldo"** en cada tarjeta de cuenta) ingresás el **saldo real actual**.
- El sistema crea automáticamente un movimiento `type = adjustment` por la diferencia exacta sin distorsionar tus gráficos de consumo ni ingresos.

---

## 6. Mapeo para el Importador del Histórico de Wallet (`.xls`)

Reglas definidas para probar el importador sobre [`imports/report_2026-06-30_215634.xls`](../imports/report_2026-06-30_215634.xls) en **D1 local**:

### Mapeo de cuentas
| Cuenta en Wallet | Cuenta v2 |
| :--- | :--- |
| `Mercado Pago` | `mp` |
| `Efectivo` | `efectivo` |
| `TC - BBVA` | `bbva_credito` |
| `TC - BBVA (USD)` | `bbva_credito_usd` |
| `TC - MP` | `mp_credito` |

### Mapeo de categorías frecuentes y especiales
| Categoría en Wallet | Destino v2 (`type` / `category_id` / `tag`) |
| :--- | :--- |
| `Comestibles` | `expense` · `supermercado` |
| `Restaurante, comida rápida` | `expense` · `comida_afuera` |
| `Comida y bebidas`, `Bar, cafetería`, `Alcohol, tabaco` | `expense` · `kiosco_cafe` |
| `Salidas`, `Juntada`, `Fiesta`, `Familia`, `Cultura, eventos deportivos`, `Pasatiempos`, `Eventos de la vida`, `Vida y entretenimiento` | `expense` · `salidas_social` *(+ tag `#familia` si venía de `Familia`)* |
| `Deporte activo, fitness` | `expense` · `deporte` |
| `Taxi` | `expense` · `uber_taxi` |
| `Transporte público`, `Larga distancia`, `Transporte` | `expense` · `transporte_publico` |
| `Combustible`, `Estacionamiento`, `Mantenimiento de vehículos`, `Seguro de vehículo` | `expense` · `auto` |
| `Software, apps, juegos`, `Teléfono, móvil`, `TV, Streaming` | `expense` · `suscripciones_servicios` |
| `Educación, desarrollo personal`, `Papelería, herramientas` | `expense` · `educacion` |
| `Cuidado de salud, doctor`, `Droguería, farmacia`, `Salud y belleza` | `expense` · `salud` |
| `Bienestar, belleza` | `expense` · `cuidado_personal` |
| `Regalos, alegrías`, `Caridad, donaciones` | `expense` · `regalos` |
| `Ropa y calzado`, `Electrónica, accesorios`, `Compras`, `Joyería, accesorios`, `Vivienda` | `expense` · `compras_ropa` *(+ tag `#hw` si la nota empieza con `HW:`)* |
| `Mascotas, animales` | `expense` · `mascotas` |
| `Impuestos`, `Cargos, comisiones`, `Gastos financieros`, `Otros`, `Vacaciones, viajes, hoteles`, `Lotería, apuestas`, `UNKNOWN_CATEGORY` | `expense` · `otros` *(+ tag `#vacaciones` si venía de `Vacaciones`)* |
| `Ingreso` (positivos) | `income` · `sueldo` *(o `otros_ingresos` si nota no salarial; negativos `Préstamos` / ajustes se revisan en script)* |
| `Intereses, dividendos` | `income` · `rendimientos` |
| `Reembolsos (impuestos, compras)` | `income` · `reintegros` |
| `Venta` | `income` · `otros_ingresos` *(+ tag `#hw` si empieza con `VENTA HW:`)* |
| `Regalos` (Ingresos) | `income` · `otros_ingresos` |
| `Inversiones`, `Inversiones financieras`, `Ahorros` | `investment` *(salidas)* / `income · otros_ingresos` *(ingresos por venta/rescate)* |
| `Gastos de Terceros` | `third_party` *(negativos)* / `third_party_repayment` *(positivos)* |
| `Préstamos, intereses` / `Préstamos, alquiler` | `third_party` *(negativos)* / `third_party_repayment` *(positivos)* |
| `Faltante` | `adjustment` |
| `TRANSFER` | Se emparejan las 2 filas (salida + entrada con mismo monto y timestamp cercano) en **1 solo registro** `type = transfer`. |

### Transformaciones adicionales del importador
- **Etiquetas:** dividir por `|` y normalizar (`hormiga`, `casa`, `abril`, `vacaciones`, `emergencia`).
- **Cuotas en notas:** detectar patrones tipo `(6x105.440)`, `(3x$14.666)`, `(1 cuota)` para poblar `installments_total` y `first_installment_month`.
- **Validación automática:** al finalizar la importación en D1 local, comparar el saldo resultante de cada cuenta contra la suma exacta del `.xls` para garantizar **diferencia \$0**.

---

## 7. Hoja de Ruta de Implementación (en rama `dev`)

1. **Etapa 2.1 (Actual):** Documentación del Modelo de Datos v2 y casos de uso (`docs/MODELO_DATOS_V2.md`).
2. **Etapa 2.2:** Migración `migrations/0002_v2_model.sql` + actualización de `src/db.ts`, `src/types.ts` y tests unitarios en Vitest.
3. **Etapa 2.3:** Actualización de `src/gemini.ts` y `src/telegram.ts` (etiquetas automáticas, split de gastos compartidos, botón `[🛡️ Pasar a Reservas]`, cuotas, inversiones y comando `/futuro`).
4. **Etapa 2.4:** Dashboard v2 en `web/` (gastos por etiqueta, bloque inversiones, proyección próximo mes vs. `MP Reservas`, conciliación de saldos, gestión de gastos fijos).
5. **Etapa 2.5:** Script importador para `.xls` de Wallet y prueba completa contra `imports/report_2026-06-30_215634.xls` en D1 local.
6. **Etapa 2.6:** Validación integral, merge `dev → main`, `db:migrate:remote`, `deploy` a producción y exportación/importación final hasta la fecha actual.
