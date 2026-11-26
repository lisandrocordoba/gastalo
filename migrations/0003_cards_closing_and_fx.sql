-- Optional credit card closing day and destination amount for cross-currency transfers
ALTER TABLE accounts ADD COLUMN closing_day INTEGER CHECK(closing_day IS NULL OR (closing_day >= 1 AND closing_day <= 31));
ALTER TABLE transactions ADD COLUMN to_amount REAL CHECK(to_amount IS NULL OR to_amount > 0);
