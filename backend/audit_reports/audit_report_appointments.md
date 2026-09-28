# Audit Report: Appointments

Generated on: 2026-08-27T05:05:16.228Z

## Endpoints Tested

### `GET /api/appointments`

**Description**: List appointments

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/appointments`

**Description**: Create appointment

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "doctorId": "00000000-0000-0000-0000-000000000000",
  "date": "2025-01-01T12:00:00Z",
  "type": "test-string",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/dashboard/upcoming-appointments`

**Description**: Upcoming appointments

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/appointment-workflow/{id}/transition`

**Description**: Transition appointment state

**Fuzz Payload**:
```json
{
  "action": "test-string",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/appointment-workflow/{id}/send-confirmation`

**Description**: Send confirmation SMS to patient

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/website-bookings`

**Description**: List website booking requests

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/website-bookings`

**Description**: Submit website booking (API key auth)

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "phone": "test-string",
  "email": "test-string",
  "service": "test-string",
  "preferredDate": "2025-01-01",
  "preferredTime": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/website-bookings/{id}/convert-to-appointment`

**Description**: Convert website booking to appointment

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "doctorId": "00000000-0000-0000-0000-000000000000",
  "date": "2025-01-01",
  "time": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

