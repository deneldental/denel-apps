# Audit Report: Patients

Generated on: 2026-08-27T05:04:10.619Z

## Endpoints Tested

### `GET /api/patients`

**Description**: List patients

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/patients`

**Description**: Create patient

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "dob": "2025-01-01T12:00:00Z",
  "gender": "test-string",
  "email": "test-string",
  "phone": "test-string",
  "category": "test-string",
  "isChild": true,
  "tagIds": [
    "00000000-0000-0000-0000-000000000000"
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patients/{id}`

**Description**: Get patient by ID

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PUT /api/patients/{id}`

**Description**: Update patient

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/medical-records`

**Description**: List medical records

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/medical-records`

**Description**: Create medical record

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "doctorId": "00000000-0000-0000-0000-000000000000",
  "treatmentTypeId": "00000000-0000-0000-0000-000000000000",
  "date": "2025-01-01T12:00:00Z"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/medical-records/pending`

**Description**: Pending medical records

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/medical-records/{id}`

**Description**: Get medical record

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/medical-records/{id}`

**Description**: Update medical record

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/medical-records/{id}`

**Description**: Delete medical record

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/medical-records/patient/{patientId}`

**Description**: Medical records for a patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/ortho-consent`

**Description**: List ortho consent forms

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/ortho-consent`

**Description**: Create ortho consent form

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "consentFormUrl": "test-string",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patient-statements/patient/{patientId}`

**Description**: List patient statements

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/patient-statements/patient/{patientId}`

**Description**: Generate patient statement PDF

**Fuzz Payload**:
```json
{
  "fromDate": "2025-01-01T12:00:00Z",
  "toDate": "2025-01-01T12:00:00Z"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patient-media/photos/patient/{patientId}`

**Description**: Patient photos

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/patient-media/photos`

**Description**: Upload patient photo record

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "imageUrl": "test-string",
  "category": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patient-media/documents/patient/{patientId}`

**Description**: Patient documents

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/odontogram/patient/{patientId}`

**Description**: Get patient odontogram

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/odontogram`

**Description**: Create odontogram entry

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "toothNumber": 1,
  "surface": "test-string",
  "condition": "test-string",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/odontogram/{id}`

**Description**: Update odontogram entry

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/odontogram/{id}`

**Description**: Delete odontogram entry

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/perio-chart/patient/{patientId}`

**Description**: Get perio chart for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/perio-chart`

**Description**: Record perio readings

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "examId": "test-string",
  "readings": [
    {
      "toothNumber": 1,
      "site": "test-string",
      "pocketDepth": 1
    }
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/perio-chart/exam/{examId}`

**Description**: Delete perio exam

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/xrays/types`

**Description**: List X-ray types

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/xrays/types`

**Description**: Create X-ray type

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "displayName": "test-string",
  "description": "test-string",
  "active": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/xrays/types/{id}`

**Description**: Update X-ray type

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/xrays/types/{id}`

**Description**: Delete X-ray type

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/xrays`

**Description**: List all X-ray records

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/xrays`

**Description**: Create X-ray record

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "imageUrl": "test-string",
  "xrayTypeId": "00000000-0000-0000-0000-000000000000",
  "source": "test-string",
  "toothNumber": 1,
  "thumbnailUrl": "test-string",
  "capturedAt": "2025-01-01T12:00:00Z",
  "externalClinicName": "test-string",
  "externalCapturedDate": "2025-01-01",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/xrays/patient/{patientId}`

**Description**: Get X-rays for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/xrays/{id}`

**Description**: Get X-ray record

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/xrays/{id}`

**Description**: Update X-ray record

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/xrays/{id}`

**Description**: Delete X-ray record

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `POST /api/xrays/share`

**Description**: Create X-ray share link

**Fuzz Payload**:
```json
{
  "xrayRecordIds": [
    "00000000-0000-0000-0000-000000000000"
  ],
  "recipientName": "test-string",
  "recipientContact": "test-string",
  "expiryDays": 1
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/xrays/share-links/patient/{patientId}`

**Description**: List X-ray share links for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/xrays/share-links/{id}/revoke`

**Description**: Revoke X-ray share link

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/xrays/public/share/{token}`

**Description**: Get public X-ray share metadata

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `POST /api/xrays/public/share/{token}/verify`

**Description**: Verify share access code and get X-rays

**Fuzz Payload**:
```json
{
  "code": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `GET /api/patient-cases/patient/{patientId}`

**Description**: List patient lab cases (patient-facing)

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/patient-cases/patient/{patientId}/prescriptions`

**Description**: Get prescriptions for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/patient-portal/appointments`

**Description**: Patient portal: upcoming appointments

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/patient-portal/records`

**Description**: Patient portal: medical records

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/patient-portal/payments`

**Description**: Patient portal: invoices and wallet

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/patient-portal/profile`

**Description**: Patient portal: get profile

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/patient-portal/profile`

**Description**: Patient portal: update profile

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patient-reminders`

**Description**: List patient reminders

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/patient-reminders`

**Description**: Create patient reminder

**Fuzz Payload**:
```json
{
  "title": "test-string",
  "reminderDate": "2025-01-01T12:00:00Z",
  "notes": "test-string",
  "patientId": "00000000-0000-0000-0000-000000000000",
  "targetType": "test-string",
  "targetSpecialistId": "00000000-0000-0000-0000-000000000000",
  "assignedToId": "00000000-0000-0000-0000-000000000000"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patient-reminders/patient/{patientId}`

**Description**: Get reminders for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/patient-reminders/{id}`

**Description**: Update patient reminder

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/patient-reminders/{id}`

**Description**: Delete patient reminder

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/patient-timeline/{patientId}`

**Description**: Get patient timeline

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/patient-timeline/{patientId}`

**Description**: Add patient timeline event

**Fuzz Payload**:
```json
{
  "title": "test-string",
  "eventType": "test-string",
  "referenceType": "test-string",
  "referenceId": "test-string",
  "description": "test-string",
  "amount": 1,
  "createdAt": "2025-01-01T12:00:00Z"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/treatment-plans`

**Description**: List treatment plans

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/treatment-plans`

**Description**: Create treatment plan

**Fuzz Payload**:
```json
{
  "patientId": "00000000-0000-0000-0000-000000000000",
  "title": "test-string",
  "notes": "test-string",
  "items": [
    {
      "procedureName": "test-string",
      "toothNumber": 1,
      "phase": 1,
      "estimatedCost": 1,
      "treatmentTypeId": "00000000-0000-0000-0000-000000000000",
      "notes": "test-string"
    }
  ]
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/treatment-plans/patient/{patientId}`

**Description**: Get treatment plans for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/treatment-plans/{id}`

**Description**: Get treatment plan

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/consent-forms/templates`

**Description**: List consent form templates

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/consent-forms/templates`

**Description**: Create consent form template

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "content": "test-string",
  "category": "test-string",
  "requiresSignature": true,
  "requiresWitness": true,
  "active": true
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/consent-forms/templates/{id}`

**Description**: Get consent form template

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `PATCH /api/consent-forms/templates/{id}`

**Description**: Update consent form template

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/consent-forms/templates/{id}`

**Description**: Delete consent form template

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/consent-forms/signed/patient/{patientId}`

**Description**: Get signed consent forms for patient

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/consent-forms/signed/{id}`

**Description**: Get signed consent form

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/consent-forms/signed`

**Description**: Submit signed consent form

**Fuzz Payload**:
```json
{
  "templateId": "00000000-0000-0000-0000-000000000000",
  "patientId": "00000000-0000-0000-0000-000000000000",
  "signatureData": "test-string",
  "signedByName": "test-string",
  "relationshipToPatient": "test-string",
  "witnessName": "test-string",
  "witnessSignatureData": "test-string",
  "notes": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/consent-templates`

**Description**: List PDF consent templates

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/consent-templates`

**Description**: Create PDF consent template

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "type": "test-string",
  "description": "test-string",
  "pdfUrl": "test-string",
  "pdfKey": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/consent-templates/{id}`

**Description**: Update PDF consent template

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/consent-templates/{id}`

**Description**: Delete PDF consent template

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `GET /api/crm/follow-ups`

**Description**: CRM follow-up queue

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/crm/recalls`

**Description**: CRM recall list

| Role | Status | Response |
|---|---|---|
| Admin | 404 | HTTP 404 |
| Doctor | 404 | HTTP 404 |
| Receptionist | 404 | HTTP 404 |

### `GET /api/crm/birthdays`

**Description**: CRM birthday list (upcoming)

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `GET /api/crm/ad-templates`

**Description**: List CRM ad templates

| Role | Status | Response |
|---|---|---|
| Admin | 401 | HTTP 401 |
| Doctor | 401 | HTTP 401 |
| Receptionist | 401 | HTTP 401 |

### `POST /api/crm/ad-templates`

**Description**: Create CRM ad template

**Fuzz Payload**:
```json
{
  "name": "test-string",
  "body": "test-string"
}
```

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `PATCH /api/crm/ad-templates/{id}`

**Description**: Update CRM ad template

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

### `DELETE /api/crm/ad-templates/{id}`

**Description**: Delete CRM ad template

| Role | Status | Response |
|---|---|---|
| Admin | 403 | HTTP 403 |
| Doctor | 403 | HTTP 403 |
| Receptionist | 403 | HTTP 403 |

