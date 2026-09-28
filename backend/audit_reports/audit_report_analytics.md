# Audit Report: Analytics

Generated on: 2026-08-27T05:05:49.184Z

## Endpoints Tested

### `GET /api/analytics/overview`

**Description**: Overview dashboard KPIs

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `GET /api/analytics/financial`

**Description**: Financial analytics

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `GET /api/dashboard/stats`

**Description**: Dashboard KPI stats (admin)

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/dashboard/doctor/stats`

**Description**: Doctor dashboard stats

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/dashboard/receptionist/stats`

**Description**: Receptionist dashboard stats

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/dashboard/alerts`

**Description**: Patient birthday and follow-up alerts

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/reports`

**Description**: List daily clinical reports

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/reports`

**Description**: Create daily clinical report

**Fuzz Payload**:
```json
{
  "reportDate": "2025-01-01",
  "inventoryUsed": [
    {}
  ],
  "productsSold": [
    {}
  ],
  "saleIds": [
    "00000000-0000-0000-0000-000000000000"
  ],
  "expenseIds": [
    "00000000-0000-0000-0000-000000000000"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/reports-injection`

**Description**: Get reports section visibility config

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PUT /api/reports-injection/{section}`

**Description**: Update report section visibility

**Fuzz Payload**:
```json
{
  "enabled": true,
  "config": {}
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

