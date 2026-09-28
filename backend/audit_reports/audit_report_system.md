# Audit Report: System

Generated on: 2026-08-27T05:01:32.768Z

## Endpoints Tested

### `GET /api/health`

**Description**: Health check

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `GET /api/csrf`

**Description**: Get CSRF token

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `GET /api/api-keys`

**Description**: List API keys

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/api-keys`

**Description**: Create API key

**Fuzz Payload**:
```json
{
  "label": "test-string",
  "scope": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/api-keys/{id}/revoke`

**Description**: Revoke API key

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/settings/locks`

**Description**: Get module lock settings

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `POST /api/settings/locks/{type}`

**Description**: Set module lock

**Fuzz Payload**:
```json
{
  "locked": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/settings/low-stock-threshold`

**Description**: Get low-stock alert threshold

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `POST /api/settings/low-stock-threshold`

**Description**: Update low-stock threshold

**Fuzz Payload**:
```json
{
  "threshold": 1
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/settings/kv/{key}`

**Description**: Get KV setting

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PUT /api/settings/kv/{key}`

**Description**: Set KV setting

**Fuzz Payload**:
```json
{
  "value": {}
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/settings/appointment-alert-config`

**Description**: Get appointment alert config

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `POST /api/settings/appointment-alert-config`

**Description**: Update appointment alert config

**Fuzz Payload**:
```json
{
  "durationMinutes": 1,
  "soundDataUrl": "test-string",
  "soundName": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/settings/hr-features`

**Description**: Get HR feature flags

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `GET /api/google-calendar/status`

**Description**: Google Calendar integration status

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `GET /api/google-calendar/per-doctor-status`

**Description**: Per-doctor Google Calendar sync status

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/google-calendar/appointment-sync/{appointmentId}`

**Description**: Get appointment Google Calendar sync info

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `POST /api/google-calendar/appointment-sync/{appointmentId}/resync`

**Description**: Resync appointment to Google Calendar

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/google-calendar/connect`

**Description**: Initiate Google Calendar OAuth flow

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `GET /api/google-calendar/callback`

**Description**: Google Calendar OAuth callback

| Role | Status | Response |
|---|---|---|
| Admin | ERROR | Error: fetch failed |
| Doctor | ERROR | Error: fetch failed |
| Receptionist | ERROR | Error: fetch failed |

### `DELETE /api/google-calendar`

**Description**: Disconnect Google Calendar

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/google-calendar/oauth-config`

**Description**: Get Google OAuth config status

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PUT /api/google-calendar/oauth-config`

**Description**: Update Google OAuth config

**Fuzz Payload**:
```json
{
  "clientId": "test-string",
  "clientSecret": "test-string",
  "redirectUri": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/google-calendar/oauth-config`

**Description**: Remove Google OAuth config

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/google-calendar/auth-method`

**Description**: Get Google Calendar auth method

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `PUT /api/google-calendar/auth-method`

**Description**: Set Google Calendar auth method

**Fuzz Payload**:
```json
{
  "method": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/google-calendar/service-account-config`

**Description**: Get service account config status

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PUT /api/google-calendar/service-account-config`

**Description**: Update service account config

**Fuzz Payload**:
```json
{
  "clientEmail": "test-string",
  "privateKey": "test-string",
  "calendarId": "test-string",
  "jsonKey": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/google-calendar/service-account-config`

**Description**: Remove service account config

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/google-calendar/service-account-config/test`

**Description**: Test service account connection

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/google-calendar/shares`

**Description**: List Google Calendar sharing rules

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/google-calendar/shares`

**Description**: Add Google Calendar sharing rules

**Fuzz Payload**:
```json
{
  "emails": [
    "test-string"
  ],
  "role": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/google-calendar/shares/{ruleId}`

**Description**: Remove Google Calendar sharing rule

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/document-tags`

**Description**: List document tags

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 403 | HTTP 403 |
| Receptionist | 200 | Success |

### `POST /api/document-tags`

**Description**: Create document tag

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "displayName": "test-string",
  "color": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/document-tags/{id}`

**Description**: Update document tag

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/document-tags/{id}`

**Description**: Delete document tag

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/compliance-categories`

**Description**: List compliance categories

| Role | Status | Response |
|---|---|---|
| Admin | 200 | Success |
| Doctor | 200 | Success |
| Receptionist | 200 | Success |

### `POST /api/compliance-categories`

**Description**: Create compliance category

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "description": "test-string",
  "color": "test-string",
  "iconName": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/compliance-categories/{id}`

**Description**: Update compliance category

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/compliance-categories/{id}`

**Description**: Delete compliance category

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

