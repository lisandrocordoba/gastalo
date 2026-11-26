-- Additional indexes for transfer lookups, recurring account references, and Telegram webhook deduplication
CREATE INDEX IF NOT EXISTS idx_transactions_to_account_id
  ON transactions(to_account_id)
  WHERE to_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_items_account_id
  ON recurring_items(account_id);

CREATE INDEX IF NOT EXISTS idx_transactions_telegram_message_id
  ON transactions(telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;
