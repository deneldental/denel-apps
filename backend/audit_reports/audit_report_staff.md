# Audit Report: Staff

Generated on: 2026-08-27T05:05:26.323Z

## Endpoints Tested

### `GET /api/staff`

**Description**: List staff members

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/staff/{id}`

**Description**: Get staff member

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/doctors`

**Description**: List doctors / specialists

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/doctors/unavailability`

**Description**: Get doctor unavailability blocks

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/doctors/unavailability`

**Description**: Create unavailability block

**Fuzz Payload**:
```json
{
  "doctorId": "00000000-0000-0000-0000-000000000000",
  "startDate": "2025-01-01T12:00:00Z",
  "endDate": "2025-01-01T12:00:00Z"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/doctors/unavailability/{id}`

**Description**: Delete unavailability block

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/messages`

**Description**: List staff messages (inbox)

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/messages`

**Description**: Send staff message

**Fuzz Payload**:
```json
{
  "receiverId": "00000000-0000-0000-0000-000000000000",
  "content": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/payroll/staff/{staffId}/components`

**Description**: Get staff payroll components

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/payroll/staff/{staffId}/components`

**Description**: Add payroll component to staff

**Fuzz Payload**:
```json
{
  "type": "test-string",
  "name": "test-string",
  "amount": 1,
  "currency": "test-string",
  "taxable": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/payroll/components/{componentId}`

**Description**: Remove payroll component

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/payroll/tax-brackets`

**Description**: Get GRA tax brackets

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/payroll/runs`

**Description**: List payroll runs

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/payroll/runs`

**Description**: Create payroll run

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "payPeriodStart": "2025-01-01",
  "payPeriodEnd": "2025-01-01",
  "includeStaffIds": [
    "00000000-0000-0000-0000-000000000000"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/specialists`

**Description**: List specialists

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/specialists`

**Description**: Create specialist

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "specialty": "test-string",
  "specialistType": "test-string",
  "contactEmail": "test-string",
  "contactPhone": "test-string",
  "tin": "test-string",
  "userId": "00000000-0000-0000-0000-000000000000",
  "password": "test-string",
  "pwaAccess": true,
  "portalAccess": true,
  "defaultCommissionRate": 1,
  "withholdingTaxRate": 1,
  "payoutMethod": "test-string",
  "isActive": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/specialists/directory`

**Description**: List active specialists for doctor pickers (redacted, no payout details)

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/specialists/{id}`

**Description**: Get specialist

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/specialists/{id}`

**Description**: Update specialist

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/specialists/{id}`

**Description**: Delete specialist

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/specialists/{id}/services`

**Description**: Get specialist services

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/staff-credentials`

**Description**: List staff credentials

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/staff-credentials`

**Description**: Create staff credential

**Fuzz Payload**:
```json
{
  "staffId": "00000000-0000-0000-0000-000000000000",
  "credentialType": "test-string",
  "credentialName": "test-string",
  "issuingBody": "test-string",
  "issueDate": "2025-01-01",
  "expiryDate": "2025-01-01",
  "documentUrl": "test-string",
  "notes": "test-string",
  "reminderDaysBefore": 1,
  "reminderEnabled": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/staff-credentials/expiring`

**Description**: List expiring staff credentials

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/staff-credentials/{id}`

**Description**: Update staff credential

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/staff-credentials/{id}`

**Description**: Delete staff credential

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

