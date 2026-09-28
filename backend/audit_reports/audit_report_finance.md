# Audit Report: Finance

Generated on: 2026-08-27T05:06:16.546Z

## Endpoints Tested

### `GET /api/accounts`

**Description**: List GL accounts

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/accounts`

**Description**: Create GL account

**Fuzz Payload**:
```json
{
  "code": "test-string",
  "name": "test-string",
  "type": "test-string",
  "normalBalance": "test-string",
  "parentId": "00000000-0000-0000-0000-000000000000",
  "isControl": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/accounts/{id}`

**Description**: Get GL account

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/accounts/{id}`

**Description**: Update GL account

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/journal-entries`

**Description**: List journal entries

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/journal-entries`

**Description**: Create journal entry

**Fuzz Payload**:
```json
{
  "entryDate": "2025-01-01",
  "description": "test-string",
  "lines": [
    {
      "accountId": "00000000-0000-0000-0000-000000000000",
      "debit": 1,
      "credit": 1
    }
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/journal-entries/{id}`

**Description**: Get journal entry with lines

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/journal-entries/{id}/reverse`

**Description**: Reverse journal entry

**Fuzz Payload**:
```json
{
  "reason": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/periods`

**Description**: List accounting periods

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/periods`

**Description**: Open new accounting period

**Fuzz Payload**:
```json
{
  "forDate": "2025-01-01"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/periods/{id}/close`

**Description**: Close accounting period

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/finance-health`

**Description**: Financial data integrity check

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/deferred-revenue`

**Description**: List deferred revenue lines

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/deferred-revenue/line/{invoiceLineId}/recognize`

**Description**: Recognize deferred revenue

**Fuzz Payload**:
```json
{
  "amount": 1,
  "trigger": "test-string",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/bills`

**Description**: List supplier bills

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/bills`

**Description**: Create supplier bill

**Fuzz Payload**:
```json
{
  "supplierId": "00000000-0000-0000-0000-000000000000",
  "supplierBillRef": "test-string",
  "dueDate": "2025-01-01",
  "lines": [
    {
      "description": "test-string",
      "unitPrice": 1,
      "quantity": 1,
      "taxRate": 1
    }
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/bills/{id}`

**Description**: Get bill with lines

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/bills/{id}/post`

**Description**: Post bill (creates GL entry)

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/bills/{id}/void`

**Description**: Void bill

**Fuzz Payload**:
```json
{
  "reason": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/bills/{id}/pay`

**Description**: Record bill payment

**Fuzz Payload**:
```json
{
  "amount": 1,
  "method": "test-string",
  "paymentDate": "2025-01-01"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/expenses`

**Description**: List expenses

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/expenses`

**Description**: Create expense

**Fuzz Payload**:
```json
{
  "category": "test-string",
  "amount": 1,
  "date": "2025-01-01",
  "description": "test-string",
  "paymentMethod": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/expenses/{id}`

**Description**: Get expense

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/expenses/{id}`

**Description**: Update expense

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/expenses/{id}`

**Description**: Delete expense

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/aging-report`

**Description**: AR aging report

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/clinic-ledger/summary`

**Description**: Clinic ledger summary

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/clinic-ledger/outstanding`

**Description**: Outstanding invoices

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/financials/records`

**Description**: Financial records (P&L view)

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/financials/daily`

**Description**: Daily transactions

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/tax-calculations`

**Description**: List tax calculations

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/tax-calculations/compute`

**Description**: Compute GRA tax breakdown

**Fuzz Payload**:
```json
{
  "baseAmount": 1,
  "applyVAT": true,
  "applyNHIL": true,
  "applyGETFund": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/tax-calculations/save`

**Description**: Save tax calculation record

**Fuzz Payload**:
```json
{
  "baseAmount": 1,
  "sourceType": "test-string",
  "patientId": "00000000-0000-0000-0000-000000000000",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/specialist-payouts`

**Description**: List specialist payouts

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/specialist-payouts`

**Description**: Create specialist payout

**Fuzz Payload**:
```json
{
  "specialistId": "00000000-0000-0000-0000-000000000000",
  "periodStart": "2025-01-01",
  "periodEnd": "2025-01-01"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/specialist-payouts/{id}/post`

**Description**: Post specialist payout (creates GL entry)

**Fuzz Payload**:
```json
{
  "method": "test-string",
  "paymentDate": "2025-01-01"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/payment-plans`

**Description**: List all payment plans

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/payment-plans`

**Description**: Create payment plan

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "totalAmount": 1,
  "type": "test-string",
  "numberOfInstallments": 1,
  "amountPerInstallment": 1,
  "startDate": "2025-01-01"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/payment-plans/overdue`

**Description**: Overdue payment plans

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/payment-plans/patient/{patientId}`

**Description**: Payment plans for a patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/insurance/companies`

**Description**: List insurance companies

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/insurance/companies`

**Description**: Create insurance company

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "contactEmail": "test-string",
  "contactPhone": "test-string",
  "address": "test-string",
  "notes": "test-string",
  "active": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/insurance/companies/{id}`

**Description**: Get insurance company

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/insurance/companies/{id}`

**Description**: Update insurance company

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/insurance/companies/{id}`

**Description**: Delete insurance company

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/insurance/pricing-documents`

**Description**: Upload pricing document

**Fuzz Payload**:
```json
{
  "companyId": "00000000-0000-0000-0000-000000000000",
  "fileUrl": "test-string",
  "fileName": "test-string",
  "fileSize": 1,
  "mimeType": "test-string",
  "isCurrent": true,
  "version": "test-string",
  "effectiveFrom": "2025-01-01",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/insurance/pricing-documents/{id}/set-current`

**Description**: Set pricing document as current

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/insurance/pricing-documents/{id}`

**Description**: Delete pricing document

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/insurance/reconciliation`

**Description**: List insurance reconciliation records

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/insurance/reconciliation`

**Description**: Create reconciliation record

**Fuzz Payload**:
```json
{
  "companyId": "00000000-0000-0000-0000-000000000000",
  "patientId": "00000000-0000-0000-0000-000000000000",
  "cardNumber": "test-string",
  "treatmentSourceType": "test-string",
  "treatmentSourceId": "test-string",
  "chargedAmount": 1,
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/insurance/reconciliation/patient/{patientId}`

**Description**: Insurance reconciliation for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/insurance/reconciliation/{id}`

**Description**: Update reconciliation record

**Fuzz Payload**:
```json
{
  "insurerPaidAmount": 1,
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/insurance/reconciliation/{id}`

**Description**: Delete reconciliation record

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/wallet/patient/{patientId}`

**Description**: Get patient wallet balance and transactions

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/wallet/patient/{patientId}/credit`

**Description**: Credit patient wallet

**Fuzz Payload**:
```json
{
  "amount": 1,
  "description": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/wallet/patient/{patientId}/allocate`

**Description**: Allocate wallet balance to invoice

**Fuzz Payload**:
```json
{
  "invoiceId": "00000000-0000-0000-0000-000000000000",
  "amount": 1
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

