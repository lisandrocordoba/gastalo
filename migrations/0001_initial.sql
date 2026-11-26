-- Clean agnostic schema v3 for Gasti Personal
-- Starts with 0 accounts and 0 transactions so every user configures
-- their own wallets, savings accounts, cash, and credit cards from Web or Telegram.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('wallet', 'savings', 'credit_card', 'cash')),
  currency TEXT NOT NULL DEFAULT 'ARS',
  initial_balance REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#009EE3',
  is_default INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER CHECK(due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('expense', 'income', 'both')),
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
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
  statement_month TEXT,
  budget_month TEXT,
  third_party_name TEXT,
  linked_group_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_linked_group_id ON transactions(linked_group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_installments
  ON transactions(first_installment_month)
  WHERE installments_total IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_statement_month
  ON transactions(statement_month)
  WHERE statement_month IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_budget_month
  ON transactions(budget_month)
  WHERE budget_month IS NOT NULL;

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag_id ON transaction_tags(tag_id);

CREATE TABLE IF NOT EXISTS recurring_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
  amount REAL NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'ARS',
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  day_of_month INTEGER CHECK(day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
  start_month TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Generic editable base categories (18 expense + 4 income)
INSERT OR IGNORE INTO categories (id, name, icon, type, color) VALUES
  ('supermercado', 'Supermercado', '🛒', 'expense', '#FF9800'),
  ('servicios', 'Servicios', '💡', 'expense', '#FB8C00'),
  ('mascotas', 'Mascotas', '🐾', 'expense', '#FFA726'),
  ('delivery', 'Delivery', '🍔', 'expense', '#F44336'),
  ('kiosco', 'Kiosco', '🍫', 'expense', '#FF7043'),
  ('compras', 'Compras', '🛍️', 'expense', '#29B6F6'),
  ('ropa', 'Ropa', '👕', 'expense', '#00ACC1'),
  ('regalos', 'Regalos', '🎁', 'expense', '#4FC3F7'),
  ('cuidado_personal', 'Cuidado personal', '💇', 'expense', '#03A9F4'),
  ('transporte_publico', 'Transporte público', '🚌', 'expense', '#78909C'),
  ('uber_taxi', 'Uber / Taxi', '🚕', 'expense', '#607D8B'),
  ('auto', 'Auto', '🚗', 'expense', '#AA00FF'),
  ('salidas_social', 'Salidas / Social', '🥂', 'expense', '#64DD17'),
  ('deporte', 'Deporte / Fitness', '⚽', 'expense', '#00E676'),
  ('educacion', 'Educación', '📚', 'expense', '#4CAF50'),
  ('salud', 'Salud', '💊', 'expense', '#26A69A'),
  ('suscripciones', 'Suscripciones', '📱', 'expense', '#536DFE'),
  ('otros', 'Otros / Trámites', '📦', 'expense', '#9E9E9E'),
  ('sueldo', 'Sueldo / Trabajo', '💼', 'income', '#FBC02D'),
  ('rendimientos', 'Rendimientos', '📈', 'income', '#FDD835'),
  ('reintegros', 'Reintegros', '🔄', 'income', '#00BFA5'),
  ('otros_ingresos', 'Otros ingresos', '💰', 'income', '#F9A825');

-- Generic editable base tags
INSERT OR IGNORE INTO tags (id, name, color) VALUES
  ('casa', 'casa', '#FF9800'),
  ('hormiga', 'hormiga', '#FF7043'),
  ('familia', 'familia', '#64DD17'),
  ('vacaciones', 'vacaciones', '#29B6F6'),
  ('emergencia', 'emergencia', '#F44336');
