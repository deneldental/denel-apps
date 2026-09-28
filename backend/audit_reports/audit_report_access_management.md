# Audit Report: Access Management

Generated on: 2026-08-27T05:05:58.100Z

## Endpoints Tested

### `GET /api/roles`

**Description**: List roles

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/roles`

**Description**: Create role

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "description": "test-string",
  "scopes": [
    "test-string"
  ],
  "bundleIds": [
    "test-string"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/roles/{id}`

**Description**: Get role by ID

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/roles/{id}`

**Description**: Update role

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/roles/{id}`

**Description**: Delete role

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PUT /api/roles/{id}/bundles`

**Description**: Replace role bundles

**Fuzz Payload**:
```json
{
  "bundleIds": [
    "test-string"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PUT /api/roles/{id}/scopes`

**Description**: Set role scopes

**Fuzz Payload**:
```json
{
  "scopes": [
    "test-string"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/roles/{id}/permissions`

**Description**: Get role permissions

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PUT /api/roles/{id}/permissions`

**Description**: Set role permissions

**Fuzz Payload**:
```json
{
  "permissions": [
    "test-string"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/roles/bundles/all`

**Description**: List all permission bundles

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/roles/bundles/{id}`

**Description**: Get permission bundle

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/roles/bundles/{id}`

**Description**: Update bundle

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/roles/bundles/{id}`

**Description**: Delete bundle

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/roles/bundles`

**Description**: Create permission bundle

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "description": "test-string",
  "scope": "test-string",
  "permissionIds": [
    "test-string"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/roles/permissions/all`

**Description**: List all available permissions

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/access-management/matrix`

**Description**: Get full permission matrix for a role

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `GET /api/users`

**Description**: List all users

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/users`

**Description**: Create user

**Fuzz Payload**:
```json
{
  "email": "test-string",
  "password": "test-string",
  "name": "test-string",
  "roleId": "test-string",
  "phone": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/users/{id}`

**Description**: Get user by ID

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/users/{id}`

**Description**: Update user

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "phone": "test-string",
  "roleId": "test-string",
  "email": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/users/{id}`

**Description**: Delete user

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/users/{id}/scopes`

**Description**: Get user interface scopes

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PUT /api/users/{id}/scopes`

**Description**: Set user scopes

**Fuzz Payload**:
```json
{
  "scopes": [
    "test-string"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

