-- Data Model v2.1 migration:
-- 1. Separate Servicios (Hogar) vs Suscripciones (Personal)
-- 2. Apply Wallet-style category & tag colors
-- 3. Add statement_month to transactions for credit card statement payments

-- 1. Insert new separated categories
INSERT INTO categories (id, name, icon, type, color) VALUES
  ('servicios', 'Servicios', '💡', 'expense', '#FB8C00'),
  ('suscripciones', 'Suscripciones', '📱', 'expense', '#536DFE')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  icon = excluded.icon,
  type = excluded.type,
  color = excluded.color;

-- Remap legacy suscripciones_servicios references
UPDATE transactions SET category_id = 'suscripciones' WHERE category_id = 'suscripciones_servicios';
UPDATE recurring_items SET category_id = 'suscripciones' WHERE category_id = 'suscripciones_servicios';
DELETE FROM categories WHERE id = 'suscripciones_servicios';

-- 2. Update Wallet-aligned palette across all categories
-- Hogar (Naranja)
UPDATE categories SET color = '#FF9800' WHERE id = 'supermercado';
UPDATE categories SET color = '#FB8C00' WHERE id = 'servicios';
UPDATE categories SET color = '#FFA726' WHERE id = 'mascotas';

-- Comida afuera / Snacks (Rojo / Coral)
UPDATE categories SET color = '#F44336' WHERE id = 'comida_afuera';
UPDATE categories SET color = '#FF7043' WHERE id = 'kiosco_cafe';

-- Compras (Celeste)
UPDATE categories SET color = '#29B6F6' WHERE id = 'compras_ropa';
UPDATE categories SET color = '#4FC3F7' WHERE id = 'regalos';
UPDATE categories SET color = '#03A9F4' WHERE id = 'cuidado_personal';

-- Transporte (Gris azulado)
UPDATE categories SET color = '#78909C' WHERE id = 'transporte_publico';
UPDATE categories SET color = '#607D8B' WHERE id = 'uber_taxi';

-- Auto (Violeta)
UPDATE categories SET color = '#AA00FF' WHERE id = 'auto';

-- Vida y Entretenimiento (Verde)
UPDATE categories SET color = '#64DD17' WHERE id = 'salidas_social';
UPDATE categories SET color = '#00E676' WHERE id = 'deporte';
UPDATE categories SET color = '#4CAF50' WHERE id = 'educacion';
UPDATE categories SET color = '#26A69A' WHERE id = 'salud';

-- Comunicaciones / Apps (Índigo)
UPDATE categories SET color = '#536DFE' WHERE id = 'suscripciones';

-- Otros (Gris)
UPDATE categories SET color = '#9E9E9E' WHERE id = 'otros';

-- Ingresos (Dorado / Teal)
UPDATE categories SET color = '#FBC02D' WHERE id = 'sueldo';
UPDATE categories SET color = '#FDD835' WHERE id = 'rendimientos';
UPDATE categories SET color = '#00BFA5' WHERE id = 'reintegros';
UPDATE categories SET color = '#F9A825' WHERE id = 'otros_ingresos';

-- Tags colors
UPDATE tags SET color = '#FF9800' WHERE id = 'casa';
UPDATE tags SET color = '#FF7043' WHERE id = 'hormiga';
UPDATE tags SET color = '#EC4899' WHERE id = 'abril';
UPDATE tags SET color = '#64DD17' WHERE id = 'familia';
UPDATE tags SET color = '#29B6F6' WHERE id = 'vacaciones';
UPDATE tags SET color = '#F44336' WHERE id = 'emergencia';
UPDATE tags SET color = '#536DFE' WHERE id = 'hw';

-- 3. Add statement_month for credit card statement payments (Opción B)
ALTER TABLE transactions ADD COLUMN statement_month TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_statement_month
  ON transactions(statement_month)
  WHERE statement_month IS NOT NULL;
