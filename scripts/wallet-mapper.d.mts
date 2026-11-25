export interface RawWalletRow {
  account: string;
  category: string;
  currency: string;
  amount: number;
  type: string;
  note: string;
  labels: string;
  payee: string;
  transfer: number;
  dateIso: string;
  isoTimestamp: string;
  timestampMs: number;
}

export interface MappedWalletTransaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  description: string;
  occurred_at: string;
  source: string;
  raw_input: string | null;
  installments_total: number | null;
  first_installment_month: string | null;
  third_party_name: string | null;
  linked_group_id: string | null;
  tags: string[];
  created_at: string;
}

export interface BalanceAuditEntry {
  account_id: string;
  raw_sum: number;
  mapped_sum: number;
  diff: number;
}

export function extractInstallments(note: string): number | null;
export function slugifyTag(name: string): string;
export function mapWalletRows(rawRows: RawWalletRow[]): {
  transactions: MappedWalletTransaction[];
  stats: {
    raw_rows: number;
    mapped_transactions: number;
    paired_transfers: number;
    orphan_transfers_as_adjustments: number;
  };
  balanceAudit: BalanceAuditEntry[];
};
