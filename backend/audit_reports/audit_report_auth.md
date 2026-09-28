# Audit Report: Auth

Generated on: 2026-08-27T05:04:02.139Z

## Endpoints Tested

### `POST /api/auth/sign-in/email`

**Description**: Sign in with email and password

**Fuzz Payload**:
```json
{
  "email": "test-string",
  "password": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 400 | HTTP 400 |
| Doctor | 400 | HTTP 400 |
| Receptionist | 400 | HTTP 400 |

### `POST /api/auth/sign-out`

**Description**: Sign out

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `GET /api/auth/get-session`

**Description**: Get current session

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `GET /api/auth/permissions`

**Description**: Get current user permissions

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/staff-auth/device-trust-status`

**Description**: Check staff device trust status

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `POST /api/staff-auth/send-device-otp`

**Description**: Send staff device OTP

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/staff-auth/verify-device-otp`

**Description**: Verify staff device OTP

**Fuzz Payload**:
```json
{
  "code": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/staff-auth/forget-this-device`

**Description**: Remove device trust for current staff session

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/staff-auth/clear-first-login`

**Description**: Clear staff first-login flag

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patient-auth/device-trust-status`

**Description**: Check patient device trust status

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `POST /api/patient-auth/send-device-otp`

**Description**: Send patient device OTP

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/patient-auth/verify-device-otp`

**Description**: Verify patient device OTP

**Fuzz Payload**:
```json
{
  "code": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/patient-auth/forget-this-device`

**Description**: Remove device trust for patient session

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/patient-auth/clear-first-login`

**Description**: Clear patient first-login flag

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

