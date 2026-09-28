# Audit Report: Communications

Generated on: 2026-08-27T05:07:49.231Z

## Endpoints Tested

### `POST /api/sms/send`

**Description**: Send SMS

**Fuzz Payload**:
```json
{
  "recipients": [
    "test-string"
  ],
  "from": "test-string",
  "type": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/sms/messages`

**Description**: SMS message history

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/sms/balance`

**Description**: SMS credit balance

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/push/subscribe`

**Description**: Subscribe to push notifications

**Fuzz Payload**:
```json
{
  "endpoint": "test-string",
  "keys": {
    "p256dh": "test-string",
    "auth": "test-string"
  }
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/push/send`

**Description**: Send push notification

**Fuzz Payload**:
```json
{
  "userIds": [
    "test-string"
  ],
  "title": "test-string",
  "body": "test-string",
  "url": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/reminder-templates`

**Description**: List reminder templates

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/reminder-templates`

**Description**: Create reminder template

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "messageTemplate": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/reminder-templates/{id}`

**Description**: Update reminder template

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "messageTemplate": "test-string",
  "isActive": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/reminder-templates/{id}`

**Description**: Delete reminder template

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/reminders/payment/cooldown-status`

**Description**: Check payment reminder cooldown status

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/reminders/payment`

**Description**: Send payment reminder SMS

**Fuzz Payload**:
```json
{
  "patientName": "test-string",
  "patientPhone": "test-string",
  "amountDue": 1,
  "isChild": true,
  "guardianPhone": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/scheduled-reminders`

**Description**: List scheduled reminders

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/scheduled-reminders`

**Description**: Create scheduled reminder

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "type": "test-string",
  "triggerType": "test-string",
  "triggerOffsetHours": 1,
  "scheduledAt": "2025-01-01T12:00:00Z",
  "cronExpression": "test-string",
  "messageTemplate": "test-string",
  "isActive": true,
  "patientId": "00000000-0000-0000-0000-000000000000",
  "templateId": "00000000-0000-0000-0000-000000000000"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/scheduled-reminders/{id}`

**Description**: Update scheduled reminder

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/scheduled-reminders/{id}`

**Description**: Delete scheduled reminder

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

