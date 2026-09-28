# Audit Report: Invoices

Generated on: 2026-08-27T05:05:21.366Z

## Endpoints Tested

### `GET /api/invoices`

**Description**: List invoices

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/invoices/{id}`

**Description**: Get invoice by ID

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

