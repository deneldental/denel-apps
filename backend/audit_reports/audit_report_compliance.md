# Audit Report: Compliance

Generated on: 2026-08-27T05:07:46.384Z

## Endpoints Tested

### `GET /api/compliance`

**Description**: List compliance documents

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/compliance`

**Description**: Create compliance document

**Fuzz Payload**:
```json
{
  "documentName": "test-string",
  "category": "test-string",
  "documentUrl": "test-string",
  "dateIssued": "2025-01-01",
  "dateExpired": "2025-01-01",
  "reminderEnabled": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/compliance/{id}`

**Description**: Update compliance document

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/compliance/{id}`

**Description**: Delete compliance document

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

