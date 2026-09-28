-- Migration 0144: Staff Loan Receivable control account (HR-C1)
--
-- Payroll loan installments are a POST-TAX deduction from take-home pay, but
-- the prior payroll GL post only reduced the net/bank credit by the loan amount
-- without a matching debit-side adjustment. That left the payroll journal entry
-- unbalanced by exactly the total loan installment whenever any staffer had an
-- active loan, so `postJournalEntry` rejected it and the ENTIRE run silently
-- failed to post (not just the loaned staff).
--
-- The correct treatment is a reclassification of cash: the employee's earned
-- gross is unchanged (salaries expense stays full), but part of their take-home
-- settles their outstanding loan instead of leaving the bank. We credit this
-- Staff Loan Receivable asset by the loan total so the entry balances:
--   CR side = PAYE + SSNIT + net(bank) + loan  ==  DR side = gross + SSNIT(er).
-- As staff repay via payroll, the receivable is drawn down toward zero.

INSERT INTO "accounts" ("code", "name", "type", "subtype", "is_control", "control_party_type", "normal_balance", "is_active")
VALUES (
  '1230',
  'Staff Loan Receivable',
  'asset',
  'Current',
  false,
  NULL,
  'debit',
  true
)
ON CONFLICT (code) DO NOTHING;
