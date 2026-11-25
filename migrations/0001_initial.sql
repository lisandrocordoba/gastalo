-- Initial schema for Gasti Personal (Wallet)

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('wallet', 'savings', 'credit_card', 'cash')),
  currency TEXT NOT NULL DEFAULT 'ARS',
  initial_balance REAL NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
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
  type TEXT NOT NULL CHECK(type IN ('expense', 'income', 'transfer')),
  amount REAL NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'ARS',
  account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  description TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  raw_input TEXT,
  telegram_message_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);

-- Default accounts
INSERT OR IGNORE INTO accounts (id, name, type, currency, initial_balance, is_default, created_at) VALUES
  ('mp', 'Mercado Pago', 'wallet', 'ARS', 0, 1, datetime('now')),
  ('mp_reservas', 'MP Reservas', 'savings', 'ARS', 0, 0, datetime('now')),
  ('bbva_credito', 'BBVA Crédito', 'credit_card', 'ARS', 0, 0, datetime('now')),
  ('efectivo', 'Efectivo', 'cash', 'ARS', 0, 0, datetime('now'));

-- Expense categories
INSERT OR IGNORE INTO categories (id, name, icon, type, color) VALUES
  ('comida', 'Comida y Salidas', '🍽️', 'expense', '#f97316'),
  ('supermercado', 'Supermercado', '🛒', 'expense', '#22c55e'),
  ('transporte', 'Transporte', '🚌', 'expense', '#3b82f6'),
  ('servicios', 'Servicios y Hogar', '💡', 'expense', '#eab308'),
  ('salud', 'Salud y Farmacia', '💊', 'expense', '#ef4444'),
  ('compras', 'Compras', '🛍️', 'expense', '#a855f7'),
  ('entretenimiento', 'Entretenimiento', '🎬', 'expense', '#ec4899'),
  ('educacion', 'Educación', '📚', 'expense', '#06b6d4'),
  ('impuestos', 'Impuestos', '🧾', 'expense', '#64748b'),
  ('otros', 'Otros', '📦', 'expense', '#71717a');

-- Income categories
INSERT OR IGNORE INTO categories (id, name, icon, type, color) VALUES
  ('sueldo', 'Sueldo', '💼', 'income', '#10b981'),
  ('rendimientos', 'Rendimientos MP', '📈', 'income', '#14b8a6'),
  ('otros_ingresos', 'Otros Ingresos', '💰', 'income', '#84cc16');
