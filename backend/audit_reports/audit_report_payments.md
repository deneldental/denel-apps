# Audit Report: Payments

Generated on: 2026-08-27T05:05:24.550Z

## Endpoints Tested

### `GET /api/payments`

**Description**: List payments

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/payments`

**Description**: Record payment

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "invoiceId": "00000000-0000-0000-0000-000000000000",
  "amount": 1,
  "method": "test-string",
  "reference": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

