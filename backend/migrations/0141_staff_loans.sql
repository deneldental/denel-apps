-- §4.3 staff_loans — loans/advances with auto-deduction from payslip
-- remainingBalance decreases each pay period by monthlyInstallment.

CREATE TABLE IF NOT EXISTS staff_loans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "staffId"       uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  description     text NOT NULL DEFAULT 'Staff loan',
  "principalAmount" numeric(12,2) NOT NULL,
  "remainingBalance" numeric(12,2) NOT NULL,
  "monthlyInstallment" numeric(12,2) NOT NULL,
  "startDate"     date NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'paused')),
  notes           text,
  "createdById"   text REFERENCES "user"(id) ON DELETE SET NULL,
  "createdAt"     timestamp NOT NULL DEFAULT now(),
  "updatedAt"     timestamp NOT NULL DEFAULT now()
);
