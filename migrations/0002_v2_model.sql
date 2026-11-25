-- Data Model v2 migration for Gasti Personal
-- Adds 6 accounts, flat v2 categories (16 expense + 4 income),
-- expanded transaction types, installments, third-party tracking,
-- N:M tags, and recurring monthly items.

-- 1. Accounts (6 total)
UPDATE accounts SET name = 'TC BBVA' WHERE id = 'bbva_credito';

INSERT OR IGNORE INTO accounts (id, name, type, currency, initial_balance, is_default, created_at) VALUES
  ('bbva_credito_usd', 'TC BBVA USD', 'credit_card', 'USD', 0, 0, datetime('now')),
  ('mp_credito', 'TC MP', 'credit_card', 'ARS', 0, 0, datetime('now'));

-- 2. Categories v2 (insert/update first to preserve FKs before remapping)
INSERT INTO categories (id, name, icon, type, color) VALUES
  ('supermercado', 'Supermercado', '🛒', 'expense', '#22c55e'),
  ('comida_afuera', 'Comida afuera / Delivery', '🍔', 'expense', '#f97316'),
  ('kiosco_cafe', 'Kiosco / Café / Snacks', '🍫', 'expense', '#f59e0b'),
  ('salidas_social', 'Salidas / Social', '🥂', 'expense', '#ec4899'),
  ('deporte', 'Deporte / Fitness', '⚽', 'expense', '#10b981'),
  ('uber_taxi', 'Uber / Taxi', '🚕', 'expense', '#3b82f6'),
  ('transporte_publico', 'Transporte público', '🚌', 'expense', '#0ea5e9'),
  ('auto', 'Auto', '🚗', 'expense', '#6366f1'),
  ('suscripciones_servicios', 'Suscripciones y Servicios', '📱', 'expense', '#eab308'),
  ('educacion', 'Educación', '📚', 'expense', '#06b6d4'),
  ('salud', 'Salud', '💊', 'expense', '#ef4444'),
  ('cuidado_personal', 'Cuidado personal', '💇', 'expense', '#d946ef'),
  ('regalos', 'Regalos', '🎁', 'expense', '#f43f5e'),
  ('compras_ropa', 'Compras y Ropa', '🛍️', 'expense', '#a855f7'),
  ('mascotas', 'Mascotas', '🐾', 'expense', '#84cc16'),
  ('otros', 'Otros / Trámites', '📦', 'expense', '#71717a'),
  ('sueldo', 'Sueldo / Trabajo', '💼', 'income', '#10b981'),
  ('rendimientos', 'Rendimientos', '📈', 'income', '#14b8a6'),
  ('reintegros', 'Reintegros', '🔄', 'income', '#06b6d4'),
  ('otros_ingresos', 'Otros ingresos', '💰', 'income', '#84cc16')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  icon = excluded.icon,
  type = excluded.type,
  color = excluded.color;

-- Remap v1 categories to v2 equivalents
UPDATE transactions SET category_id = 'comida_afuera' WHERE category_id = 'comida';
UPDATE transactions SET category_id = 'transporte_publico' WHERE category_id = 'transporte';
UPDATE transactions SET category_id = 'suscripciones_servicios' WHERE category_id = 'servicios';
UPDATE transactions SET category_id = 'compras_ropa' WHERE category_id = 'compras';
UPDATE transactions SET category_id = 'salidas_social' WHERE category_id = 'entretenimiento';
UPDATE transactions SET category_id = 'otros' WHERE category_id = 'impuestos';

DELETE FROM categories
WHERE id IN ('comida', 'transporte', 'servicios', 'compras', 'entretenimiento', 'impuestos');

-- 3. Rebuild transactions table with expanded types and v2 columns
CREATE TABLE transactions_v2 (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('expense', 'income', 'transfer', 'investment', 'third_party', 'third_party_repayment', 'adjustment')),
  amount REAL NOT NULL CHECK((type = 'adjustment' AND amount != 0) OR amount > 0),
  currency TEXT NOT NULL DEFAULT 'ARS',
  account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  description TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_input TEXT,
  telegram_message_id INTEGER,
  installments_total INTEGER CHECK(installments_total IS NULL OR installments_total >= 1),
  first_installment_month TEXT,
  third_party_name TEXT,
  linked_group_id TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO transactions_v2 (
  id, type, amount, currency, account_id, to_account_id, category_id,
  description, occurred_at, source, raw_input, telegram_message_id,
  installments_total, first_installment_month, third_party_name, linked_group_id, created_at
)
SELECT
  id, type, amount, currency, account_id, to_account_id, category_id,
  description, occurred_at, source, raw_input, telegram_message_id,
  NULL, NULL, NULL, NULL, created_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_v2 RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_linked_group_id ON transactions(linked_group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_installments
  ON transactions(first_installment_month)
  WHERE installments_total IS NOT NULL;

-- 4. Tags (N:M)
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

INSERT OR IGNORE INTO tags (id, name, color) VALUES
  ('casa', 'casa', '#22c55e'),
  ('hormiga', 'hormiga', '#f59e0b'),
  ('abril', 'abril', '#ec4899'),
  ('familia', 'familia', '#3b82f6'),
  ('vacaciones', 'vacaciones', '#06b6d4'),
  ('emergencia', 'emergencia', '#ef4444'),
  ('hw', 'hw', '#a855f7');

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag_id ON transaction_tags(tag_id);

-- 5. Recurring monthly items
CREATE TABLE IF NOT EXISTS recurring_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
  amount REAL NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'ARS',
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  day_of_month INTEGER CHECK(day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
