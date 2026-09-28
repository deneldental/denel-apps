# Audit Report: Services

Generated on: 2026-08-27T05:07:04.250Z

## Endpoints Tested

### `GET /api/treatments`

**Description**: List active treatment types

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/services`

**Description**: List services

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/services`

**Description**: Create service

**Fuzz Payload**:
```json
{
  "category": "test-string",
  "name": "test-string",
  "amount": 1,
  "isActive": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/services/{id}`

**Description**: Get service

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/services/{id}`

**Description**: Update service (may create pending review)

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/services/{id}/doctors`

**Description**: Get doctors assigned to service

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PUT /api/services/{id}/doctors`

**Description**: Update doctor assignments for service

**Fuzz Payload**:
```json
{
  "doctors": [
    {
      "doctorId": "00000000-0000-0000-0000-000000000000",
      "commissionRate": 1,
      "noCommission": true
    }
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/sales`

**Description**: List store sales

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/sales`

**Description**: Record store sale

**Fuzz Payload**:
```json
{
  "productId": "00000000-0000-0000-0000-000000000000",
  "quantity": 1,
  "unitPrice": 1,
  "costPrice": 1
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/inventory`

**Description**: List inventory items

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/inventory`

**Description**: Create inventory item

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/inventory/{id}`

**Description**: Get inventory item

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/inventory/{id}`

**Description**: Update inventory item

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/inventory/{id}`

**Description**: Delete inventory item

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/inventory-locations`

**Description**: List inventory locations

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/inventory-locations`

**Description**: Create inventory location

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "code": "test-string",
  "description": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/inventory-locations/{id}`

**Description**: Update inventory location

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/inventory-locations/{id}`

**Description**: Delete inventory location

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/labs/vendors`

**Description**: List lab vendors

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/labs/vendors`

**Description**: Create lab vendor

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "type": "test-string",
  "contactEmail": "test-string",
  "contactPhone": "test-string",
  "address": "test-string",
  "notes": "test-string",
  "active": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/labs/vendors/{id}`

**Description**: Get lab vendor

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/labs/vendors/{id}`

**Description**: Update lab vendor

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/labs/vendors/{id}`

**Description**: Delete lab vendor

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/labs/vendors/{vendorId}/services`

**Description**: List vendor lab services

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/labs/vendors/{vendorId}/services`

**Description**: Add service to vendor

**Fuzz Payload**:
```json
{
  "baseServiceId": "00000000-0000-0000-0000-000000000000",
  "regularCost": 1,
  "regularTurnaroundDays": 1,
  "notes": "test-string",
  "active": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/labs/services/{id}`

**Description**: Update vendor lab service

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/labs/services/{id}`

**Description**: Delete vendor lab service

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/labs/services/{serviceId}/express-options`

**Description**: Add express option to lab service

**Fuzz Payload**:
```json
{
  "label": "test-string",
  "cost": 1,
  "turnaroundDays": 1,
  "sortOrder": 1
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/labs/express-options/{id}`

**Description**: Update express option

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/labs/express-options/{id}`

**Description**: Delete express option

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/labs/service-catalog`

**Description**: Lab service catalog (all vendors Ã services)

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/labs/base-services`

**Description**: List base lab service types

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/labs/base-services`

**Description**: Create base lab service type

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "categoryId": "00000000-0000-0000-0000-000000000000",
  "unitType": "test-string",
  "standardTurnaroundDays": 1,
  "notes": "test-string",
  "isActive": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/labs/base-services/{id}`

**Description**: Update base lab service

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/labs/base-services/{id}`

**Description**: Delete base lab service

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/labs/categories`

**Description**: List lab categories

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/labs/categories`

**Description**: Create lab category

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "isActive": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/labs/categories/{id}`

**Description**: Update lab category

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/labs/categories/{id}`

**Description**: Delete lab category

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/labs/cases`

**Description**: List lab cases

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/labs/cases`

**Description**: Create lab case

**Fuzz Payload**:
```json
{
  "vendorId": "00000000-0000-0000-0000-000000000000",
  "serviceId": "00000000-0000-0000-0000-000000000000",
  "domain": "test-string",
  "patientId": "00000000-0000-0000-0000-000000000000",
  "referringDoctorId": "00000000-0000-0000-0000-000000000000",
  "externalPatientName": "test-string",
  "units": 1,
  "patientCharge": 1,
  "expressOptionId": "00000000-0000-0000-0000-000000000000",
  "sentAt": "2025-01-01T12:00:00Z",
  "expectedReturn": "2025-01-01",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/labs/cases/expense-ready`

**Description**: Lab cases ready for expense creation

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/labs/cases/{id}`

**Description**: Get lab case

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/labs/cases/{id}`

**Description**: Update lab case

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/labs/cases/{id}`

**Description**: Delete lab case

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/labs/cases/{id}/clear-expense`

**Description**: Mark lab case expense as cleared

**Fuzz Payload**:
```json
{
  "amount": 1,
  "date": "2025-01-01",
  "paymentMethod": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/labs/cases/{id}/photos`

**Description**: Add photo to lab case

**Fuzz Payload**:
```json
{
  "photoUrl": "test-string",
  "photoType": "test-string",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/labs/photos/{id}`

**Description**: Delete lab case photo

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/products`

**Description**: List store products

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/products`

**Description**: Create product

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/products/{id}`

**Description**: Get product

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/products/{id}`

**Description**: Update product

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/products/{id}`

**Description**: Delete product

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

