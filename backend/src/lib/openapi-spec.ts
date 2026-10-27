/**
 * OpenAPI 3.1 specification for the Denel backend API.
 *
 * This is a curated human-maintained spec covering the primary route groups.
 * It is NOT auto-generated — it documents intent and serves as the frontend
 * contract reference. Swagger UI is served at GET /api/docs.
 *
 * Adding a new route group:
 *  1. Add a tag in `info.tags`
 *  2. Add paths under the relevant prefix
 *  3. Run typecheck to confirm the spec is valid TS
 */

export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Denel API',
    version: '1.0.0',
    description:
      'REST API for Denel Dental Clinic Management System. All endpoints require a valid session cookie except `/api/auth/*` and `/api/health`.',
    contact: { email: 'dev@deneldental.com' },
  },
  servers: [
    { url: 'https://api.deneldental.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local dev' },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication and session management' },
    { name: 'Patients', description: 'Patient records and PWA access' },
    { name: 'Appointments', description: 'Appointment scheduling and workflow' },
    { name: 'Invoices', description: 'Financial invoices' },
    { name: 'Payments', description: 'Payment recording and search' },
    { name: 'Staff', description: 'Staff member profiles' },
    { name: 'Analytics', description: 'Clinical, financial and operational analytics' },
    { name: 'Access Management', description: 'RBAC roles, bundles and permissions' },
    { name: 'System', description: 'Health, CSRF and diagnostic endpoints' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'portal.session_token',
        description:
          'Better Auth session cookie (name varies by app: portal.*, staff-pwa.*, reports.*)',
      },
    },
    responses: {
      Unauthorized: {
        description: 'Not authenticated',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Insufficient permissions',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', example: 'Not authenticated' },
          code: { type: 'string', example: 'VALIDATION_ERROR' },
        },
      },
      PaginationMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 248 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 50 },
          totalPages: { type: 'integer', example: 5 },
        },
      },
      Patient: {
        type: 'object',
        required: ['id', 'name', 'dob', 'gender'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          patientId: { type: 'string', example: '#FDM000001' },
          name: { type: 'string', example: 'Kwame Asante' },
          email: { type: 'string', format: 'email', nullable: true },
          phone: { type: 'string', nullable: true },
          dob: { type: 'string', format: 'date-time' },
          gender: { type: 'string', enum: ['male', 'female', 'other'] },
          category: { type: 'string', enum: ['ongoing', 'one_time'], default: 'ongoing' },
          isChild: { type: 'boolean', default: false },
          // §2.7 — treatment-derived / manual labels; replaces the old type/isOrtho fields.
          tags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string', example: 'Ortho' },
                color: { type: 'string', example: 'violet' },
              },
            },
          },
          pwaAccessEnabled: { type: 'boolean', default: false },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Appointment: {
        type: 'object',
        required: ['id', 'patientId', 'date', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          patientId: { type: 'string', format: 'uuid' },
          doctorId: { type: 'string', format: 'uuid', nullable: true },
          date: { type: 'string', format: 'date-time' },
          status: {
            type: 'string',
            enum: ['scheduled', 'confirmed', 'checked_in', 'in_chair', 'completed', 'cancelled'],
          },
          type: { type: 'string', example: 'Extraction' },
          notes: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Invoice: {
        type: 'object',
        required: ['id', 'patientId', 'total', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          invoiceNumber: { type: 'string', example: 'INV-2026-0001' },
          patientId: { type: 'string', format: 'uuid' },
          total: { type: 'number', format: 'decimal', example: 1250.0 },
          amountPaid: { type: 'number', format: 'decimal', example: 500.0 },
          balance: { type: 'number', format: 'decimal', example: 750.0 },
          status: { type: 'string', enum: ['draft', 'issued', 'partially_paid', 'paid', 'void'] },
          issuedAt: { type: 'string', format: 'date-time', nullable: true },
          dueDate: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Payment: {
        type: 'object',
        required: ['id', 'patientId', 'amount', 'method'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          patientId: { type: 'string', format: 'uuid' },
          amount: { type: 'number', format: 'decimal', example: 500.0 },
          method: {
            type: 'string',
            enum: ['cash', 'momo', 'card', 'bank_transfer', 'cheque', 'wallet'],
          },
          reference: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    // ── System ─────────────────────────────────────────────────────────────────
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    service: { type: 'string', example: 'denel-backend' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/csrf': {
      get: {
        tags: ['System'],
        summary: 'Get CSRF token',
        description:
          'Returns a CSRF token for the current session. The token is also set as a cookie. Include the token value in the X-CSRF-Token header for all POST/PUT/PATCH/DELETE requests.',
        security: [],
        responses: {
          '200': {
            description: 'CSRF token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { token: { type: 'string', example: 'a1b2c3...' } },
                },
              },
            },
          },
        },
      },
    },
    // ── Auth ───────────────────────────────────────────────────────────────────
    '/api/auth/sign-in/email': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in with email and password',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Session created — session cookie set' },
          '401': { description: 'Invalid credentials' },
          '429': { description: 'Rate limit exceeded (5 attempts / 60s)' },
        },
      },
    },
    '/api/auth/sign-out': {
      post: {
        tags: ['Auth'],
        summary: 'Sign out',
        responses: {
          '200': { description: 'Session invalidated' },
        },
      },
    },
    '/api/auth/get-session': {
      get: {
        tags: ['Auth'],
        summary: 'Get current session',
        responses: {
          '200': { description: 'Session and user data including roleId' },
          '401': { description: 'No active session' },
        },
      },
    },
    '/api/auth/permissions': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user permissions',
        description: 'Returns isAdmin, resolved permission scopes, and accessible module list.',
        responses: {
          '200': {
            description: 'Permission map',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    isAdmin: { type: 'boolean' },
                    scopes: { type: 'array', items: { type: 'string' } },
                    accessibleModules: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    // ── Patients ───────────────────────────────────────────────────────────────
    '/api/patients': {
      get: {
        tags: ['Patients'],
        summary: 'List patients',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          {
            name: 'category',
            in: 'query',
            schema: { type: 'string', enum: ['ongoing', 'one_time'] },
          },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': {
            description: 'Paginated patient list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Patient' } },
                    meta: { $ref: '#/components/schemas/PaginationMeta' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create patient',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'dob', 'gender'],
                properties: {
                  name: { type: 'string' },
                  dob: { type: 'string', format: 'date-time' },
                  gender: { type: 'string', enum: ['male', 'female', 'other'] },
                  email: { type: 'string', format: 'email' },
                  phone: { type: 'string' },
                  category: { type: 'string', enum: ['ongoing', 'one_time'] },
                  isChild: { type: 'boolean' },
                  // §2.7 — patient_tags ids applied on creation (replaces type/isOrtho).
                  tagIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Patient created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Patient' },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation error' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/api/patients/{id}': {
      get: {
        tags: ['Patients'],
        summary: 'Get patient by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Patient record',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Patient' },
                  },
                },
              },
            },
          },
          '404': { description: 'Not found' },
        },
      },
      put: {
        tags: ['Patients'],
        summary: 'Update patient',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Patient' } } },
        },
        responses: {
          '200': { description: 'Updated patient' },
          '404': { description: 'Not found' },
        },
      },
    },
    // ── Appointments ───────────────────────────────────────────────────────────
    '/api/appointments': {
      get: {
        tags: ['Appointments'],
        summary: 'List appointments',
        parameters: [
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'doctorId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': {
            description: 'Appointment list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Appointment' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Appointments'],
        summary: 'Create appointment',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'date'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  doctorId: { type: 'string', format: 'uuid' },
                  date: { type: 'string', format: 'date-time' },
                  type: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Appointment created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    // ── Invoices ───────────────────────────────────────────────────────────────
    '/api/invoices': {
      get: {
        tags: ['Invoices'],
        summary: 'List invoices',
        parameters: [
          { name: 'patientId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': {
            description: 'Invoice list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/invoices/{id}': {
      get: {
        tags: ['Invoices'],
        summary: 'Get invoice by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Invoice detail' },
          '404': { description: 'Not found' },
        },
      },
    },
    // ── Payments ───────────────────────────────────────────────────────────────
    '/api/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List payments',
        parameters: [
          { name: 'patientId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'method', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: { '200': { description: 'Payment list' } },
      },
      post: {
        tags: ['Payments'],
        summary: 'Record payment',
        description:
          'Send either `amount` and `method` (one method), or `sources` (one payment split ' +
          'across several methods, e.g. part cash and part card), not both. Money is in whole ' +
          'pesewas. A split becomes one payment per method, all sharing one `paymentGroupId`, ' +
          'recorded together or not at all. The total is worked out from the payments recorded.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  invoiceId: { type: 'string', format: 'uuid' },
                  amount: { type: 'integer', description: 'One-method shape: pesewas.' },
                  method: {
                    type: 'string',
                    description:
                      'One-method shape: a payment method from Settings (or a built-in one).',
                  },
                  sources: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 20,
                    description:
                      'Split shape. Each method must be one an administrator has active in ' +
                      'Settings (or a built-in one with no Settings row).',
                    items: {
                      type: 'object',
                      required: ['method', 'amount'],
                      properties: {
                        method: { type: 'string' },
                        amount: { type: 'integer', minimum: 1, description: 'Pesewas.' },
                        externalReference: { type: 'string' },
                      },
                    },
                  },
                  reference: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'Payment recorded. `data` is the first payment; `payments` lists every payment ' +
              'recorded (one per method); `paymentGroupId` is shared by a split and null otherwise.',
          },
          '400': { description: 'Validation error (a sentence)' },
        },
      },
    },
    '/api/payments/{id}/post': {
      post: {
        tags: ['Payments'],
        summary: 'Post a draft payment (writes its journal entry; posting it again is harmless)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sendSms: {
                    type: 'boolean',
                    description:
                      'Text the patient a payment confirmation naming what was posted: this payment, or every ' +
                      'posted payment of its group (send it with the last payment of a split). At most once per ' +
                      'payment event; a failed text is reported as `smsError` and never fails the posting.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The posted payment and its journal entry; `smsError` when the text failed',
          },
          '400': { description: 'Not postable (a sentence)' },
        },
      },
    },
    '/api/worklist/{id}/confirm': {
      post: {
        tags: ['Payments'],
        summary: 'Confirm an estimate: issue it and, optionally, take a payment for it',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The visit (appointment) id, or the invoice id of a standalone estimate',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  payments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['method', 'amount'],
                      properties: {
                        method: { type: 'string' },
                        amount: { type: 'integer', description: 'Pesewas' },
                        externalReference: { type: 'string', nullable: true },
                      },
                    },
                  },
                  acceptedLineItemIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  sendSms: {
                    type: 'boolean',
                    description:
                      'Text the patient a confirmation of the payment taken, once, for its posted total. A ' +
                      'confirm with no payment texts nobody; a failed text is reported as `smsError`.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The issued invoice and the payment taken; `smsError` when the text failed',
          },
          '404': { description: 'No draft estimate for this visit' },
        },
      },
    },
    // ── Staff ──────────────────────────────────────────────────────────────────
    '/api/staff': {
      get: {
        tags: ['Staff'],
        summary: 'List staff members',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: { '200': { description: 'Staff list' } },
      },
    },
    '/api/staff/{id}': {
      get: {
        tags: ['Staff'],
        summary: 'Get staff member',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Staff member record' },
          '404': { description: 'Not found' },
        },
      },
    },
    // ── Analytics ──────────────────────────────────────────────────────────────
    '/api/analytics/overview': {
      get: {
        tags: ['Analytics'],
        summary: 'Overview dashboard KPIs',
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          {
            name: 'granularity',
            in: 'query',
            schema: { type: 'string', enum: ['day', 'week', 'month'] },
          },
        ],
        responses: { '200': { description: 'Overview KPI tiles and trend series' } },
      },
    },
    '/api/analytics/financial': {
      get: {
        tags: ['Analytics'],
        summary: 'Financial analytics',
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'Revenue, collections, AR aging, payment method mix' } },
      },
    },
    // ── Access Management ──────────────────────────────────────────────────────
    '/api/roles': {
      get: {
        tags: ['Access Management'],
        summary: 'List roles',
        responses: { '200': { description: 'All system roles' } },
      },
      post: {
        tags: ['Access Management'],
        summary: 'Create role',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  scopes: { type: 'array', items: { type: 'string' } },
                  bundleIds: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: '{ id, name }' } },
      },
    },
    '/api/roles/{id}': {
      get: {
        tags: ['Access Management'],
        summary: 'Get role by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Role with bundles and scopes' } },
      },
      patch: {
        tags: ['Access Management'],
        summary: 'Update role',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated role' } },
      },
      delete: {
        tags: ['Access Management'],
        summary: 'Delete role',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/roles/{id}/bundles': {
      put: {
        tags: ['Access Management'],
        summary: 'Replace role bundles',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bundleIds'],
                properties: { bundleIds: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: { '200': { description: '{ diff }' } },
      },
    },
    '/api/roles/{id}/scopes': {
      put: {
        tags: ['Access Management'],
        summary: 'Set role scopes',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['scopes'],
                properties: { scopes: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: { '200': { description: 'Scopes updated' } },
      },
    },
    '/api/roles/{id}/permissions': {
      get: {
        tags: ['Access Management'],
        summary: 'Get role permissions',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ roleId, mode, permissions }' } },
      },
      put: {
        tags: ['Access Management'],
        summary: 'Set role permissions',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['permissions'],
                properties: { permissions: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
        responses: { '200': { description: '{ permissionCount }' } },
      },
    },
    '/api/roles/bundles/all': {
      get: {
        tags: ['Access Management'],
        summary: 'List all permission bundles',
        responses: { '200': { description: 'Bundle list' } },
      },
    },
    '/api/roles/bundles/{id}': {
      get: {
        tags: ['Access Management'],
        summary: 'Get permission bundle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Bundle with permissions' } },
      },
      patch: {
        tags: ['Access Management'],
        summary: 'Update bundle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated bundle' } },
      },
      delete: {
        tags: ['Access Management'],
        summary: 'Delete bundle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/roles/bundles': {
      post: {
        tags: ['Access Management'],
        summary: 'Create permission bundle',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'scope'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  scope: { type: 'string' },
                  permissionIds: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: '{ id, name }' } },
      },
    },
    '/api/roles/permissions/all': {
      get: {
        tags: ['Access Management'],
        summary: 'List all available permissions',
        responses: { '200': { description: 'Permission list' } },
      },
    },
    '/api/access-management/matrix': {
      get: {
        tags: ['Access Management'],
        summary: 'Get full permission matrix for a role',
        parameters: [{ name: 'roleId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Module → actions permission map' } },
      },
    },
    // ── Users ──────────────────────────────────────────────────────────────────
    '/api/users': {
      get: {
        tags: ['Access Management'],
        summary: 'List all users',
        responses: { '200': { description: 'User list' } },
      },
      post: {
        tags: ['Access Management'],
        summary: 'Create user',
        description:
          'The password is the administrator’s choice, so the new user must change it at first sign-in (`mustChangePassword`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  name: { type: 'string' },
                  roleId: { type: 'string' },
                  phone: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'User created' } },
      },
    },
    '/api/users/{id}': {
      get: {
        tags: ['Access Management'],
        summary: 'Get user by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'User' } },
      },
      patch: {
        tags: ['Access Management'],
        summary: 'Update user',
        description:
          'A `password` replaces the credential and ends every session of that user. Unless the caller is changing their own, the user must then choose a new password at next sign-in (`mustChangePassword`).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  roleId: { type: 'string' },
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated user' },
          '400': { description: 'Invalid e-mail, or a password the policy refuses' },
          '404': { description: 'No such user (when a password is sent)' },
        },
      },
      delete: {
        tags: ['Access Management'],
        summary: 'Delete user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'User deleted' } },
      },
    },
    '/api/users/{id}/scopes': {
      get: {
        tags: ['Access Management'],
        summary: 'Get user interface scopes',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Scope list' } },
      },
      put: {
        tags: ['Access Management'],
        summary: 'Set user scopes',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scopes: { type: 'array', items: { type: 'string', enum: ['portal', 'pwa'] } },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Scopes updated' } },
      },
    },
    // ── Dashboard ──────────────────────────────────────────────────────────────
    '/api/dashboard/stats': {
      get: {
        tags: ['Analytics'],
        summary: 'Dashboard KPI stats (admin)',
        parameters: [
          {
            name: 'period',
            in: 'query',
            schema: { type: 'string', enum: ['day', 'week', 'month'] },
          },
        ],
        responses: {
          '200': { description: 'totalPatients, totalRevenue, totalExpenses, checkedIn, booked' },
        },
      },
    },
    '/api/dashboard/doctor/stats': {
      get: {
        tags: ['Analytics'],
        summary: 'Doctor dashboard stats',
        responses: {
          '200': {
            description: 'Ortho patients, consent forms, medical records, check-ins, bookings',
          },
        },
      },
    },
    '/api/dashboard/receptionist/stats': {
      get: {
        tags: ['Analytics'],
        summary: 'Receptionist dashboard stats',
        parameters: [{ name: 'period', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Total patients, payments, expenses, check-ins, bookings' },
        },
      },
    },
    '/api/dashboard/upcoming-appointments': {
      get: {
        tags: ['Appointments'],
        summary: 'Upcoming appointments',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }],
        responses: { '200': { description: 'Upcoming appointment list' } },
      },
    },
    '/api/dashboard/alerts': {
      get: {
        tags: ['Analytics'],
        summary: 'Patient birthday and follow-up alerts',
        responses: { '200': { description: '{ birthdays, followups }' } },
      },
    },
    // ── Accounting ─────────────────────────────────────────────────────────────
    '/api/accounts': {
      get: {
        tags: ['Finance'],
        summary: 'List GL accounts',
        parameters: [
          {
            name: 'type',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
            },
          },
        ],
        responses: { '200': { description: 'Chart of accounts' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create GL account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code', 'name', 'type', 'normalBalance'],
                properties: {
                  code: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string' },
                  normalBalance: { type: 'string', enum: ['debit', 'credit'] },
                  parentId: { type: 'string', format: 'uuid' },
                  isControl: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Account created' } },
      },
    },
    '/api/accounts/{id}': {
      get: {
        tags: ['Finance'],
        summary: 'Get GL account',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Account' } },
      },
      patch: {
        tags: ['Finance'],
        summary: 'Update GL account',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated account' } },
      },
    },
    '/api/journal-entries': {
      get: {
        tags: ['Finance'],
        summary: 'List journal entries',
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'Journal entry list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create journal entry',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['entryDate', 'lines'],
                properties: {
                  entryDate: { type: 'string', format: 'date' },
                  description: { type: 'string' },
                  lines: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        accountId: { type: 'string', format: 'uuid' },
                        debit: { type: 'number' },
                        credit: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Journal entry created' } },
      },
    },
    '/api/journal-entries/{id}': {
      get: {
        tags: ['Finance'],
        summary: 'Get journal entry with lines',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Journal entry detail' } },
      },
    },
    '/api/journal-entries/{id}/reverse': {
      post: {
        tags: ['Finance'],
        summary: 'Reverse journal entry',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { reason: { type: 'string' } } },
            },
          },
        },
        responses: { '201': { description: 'Reversal entry created' } },
      },
    },
    '/api/periods': {
      get: {
        tags: ['Finance'],
        summary: 'List accounting periods',
        responses: { '200': { description: 'Period list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Open new accounting period',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['forDate'],
                properties: { forDate: { type: 'string', format: 'date' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Period created' } },
      },
    },
    '/api/periods/{id}/close': {
      post: {
        tags: ['Finance'],
        summary: 'Close accounting period',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Period closed' } },
      },
    },
    '/api/finance-health': {
      get: {
        tags: ['Finance'],
        summary: 'Financial data integrity check',
        responses: { '200': { description: '{ ok, unbalancedEntries }' } },
      },
    },
    '/api/deferred-revenue': {
      get: {
        tags: ['Finance'],
        summary: 'List deferred revenue lines',
        parameters: [
          { name: 'outstandingOnly', in: 'query', schema: { type: 'boolean', default: true } },
          { name: 'invoiceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deferred revenue lines' } },
      },
    },
    '/api/deferred-revenue/line/{invoiceLineId}/recognize': {
      post: {
        tags: ['Finance'],
        summary: 'Recognize deferred revenue',
        parameters: [
          {
            name: 'invoiceLineId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: {
                  amount: { type: 'number' },
                  trigger: { type: 'string', enum: ['manual', 'milestone', 'period_close'] },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Revenue recognized' } },
      },
    },
    // ── Bills (Accounts Payable) ───────────────────────────────────────────────
    '/api/bills': {
      get: {
        tags: ['Finance'],
        summary: 'List supplier bills',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'supplierId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Bill list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create supplier bill',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['supplierId', 'lines'],
                properties: {
                  supplierId: { type: 'string', format: 'uuid' },
                  supplierBillRef: { type: 'string' },
                  dueDate: { type: 'string', format: 'date' },
                  lines: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['description', 'unitPrice', 'expenseAccountId'],
                      properties: {
                        description: { type: 'string' },
                        unitPrice: { type: 'number' },
                        quantity: { type: 'number' },
                        taxRate: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Bill created' } },
      },
    },
    '/api/bills/{id}': {
      get: {
        tags: ['Finance'],
        summary: 'Get bill with lines',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Bill detail' } },
      },
    },
    '/api/bills/{id}/post': {
      post: {
        tags: ['Finance'],
        summary: 'Post bill (creates GL entry)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: '{ bill, journalEntry }' } },
      },
    },
    '/api/bills/{id}/void': {
      post: {
        tags: ['Finance'],
        summary: 'Void bill',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: { reason: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Bill voided' } },
      },
    },
    '/api/bills/{id}/pay': {
      post: {
        tags: ['Finance'],
        summary: 'Record bill payment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount', 'method'],
                properties: {
                  amount: { type: 'number' },
                  method: { type: 'string' },
                  paymentDate: { type: 'string', format: 'date' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Payment recorded' } },
      },
    },
    // ── Expenses ───────────────────────────────────────────────────────────────
    '/api/expenses': {
      get: {
        tags: ['Finance'],
        summary: 'List expenses',
        responses: { '200': { description: 'Expense list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create expense',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['category', 'amount', 'date'],
                properties: {
                  category: { type: 'string' },
                  amount: { type: 'number' },
                  date: { type: 'string', format: 'date' },
                  description: { type: 'string' },
                  paymentMethod: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Expense created' } },
      },
    },
    '/api/expenses/{id}': {
      get: {
        tags: ['Finance'],
        summary: 'Get expense',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Expense' } },
      },
      patch: {
        tags: ['Finance'],
        summary: 'Update expense',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated expense' } },
      },
      delete: {
        tags: ['Finance'],
        summary: 'Delete expense',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/aging-report': {
      get: {
        tags: ['Finance'],
        summary: 'AR aging report',
        parameters: [{ name: 'asOf', in: 'query', schema: { type: 'string', format: 'date' } }],
        responses: { '200': { description: 'Aging buckets (current, 30d, 60d, 90d, 90d+)' } },
      },
    },
    '/api/clinic-ledger/summary': {
      get: {
        tags: ['Finance'],
        summary: 'Clinic ledger summary',
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': { description: '{ revenue, aging, expenses, netCashPosition, wallets, plans }' },
        },
      },
    },
    '/api/clinic-ledger/outstanding': {
      get: {
        tags: ['Finance'],
        summary: 'Outstanding invoices',
        responses: { '200': { description: 'Unpaid invoices with patient info' } },
      },
    },
    '/api/financials/records': {
      get: {
        tags: ['Finance'],
        summary: 'Financial records (P&L view)',
        parameters: [
          {
            name: 'view',
            in: 'query',
            schema: { type: 'string', enum: ['week', 'month', 'year'] },
          },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: '{ totalIncome, totalExpenses, netProfit, records }' } },
      },
    },
    '/api/financials/daily': {
      get: {
        tags: ['Finance'],
        summary: 'Daily transactions',
        parameters: [
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: '{ transactions, pagination }' } },
      },
    },
    '/api/tax-calculations': {
      get: {
        tags: ['Finance'],
        summary: 'List tax calculations',
        parameters: [
          { name: 'patientId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Tax calculation records' } },
      },
    },
    '/api/tax-calculations/compute': {
      post: {
        tags: ['Finance'],
        summary: 'Compute GRA tax breakdown',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['baseAmount'],
                properties: {
                  baseAmount: { type: 'number' },
                  applyVAT: { type: 'boolean' },
                  applyNHIL: { type: 'boolean' },
                  applyGETFund: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Tax breakdown with rates' } },
      },
    },
    '/api/tax-calculations/save': {
      post: {
        tags: ['Finance'],
        summary: 'Save tax calculation record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['baseAmount'],
                properties: {
                  baseAmount: { type: 'number' },
                  sourceType: { type: 'string' },
                  patientId: { type: 'string', format: 'uuid' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Saved calculation' } },
      },
    },
    '/api/specialist-payouts': {
      get: {
        tags: ['Finance'],
        summary: 'List specialist payouts',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'specialistId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Payout list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create specialist payout',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['specialistId', 'periodStart', 'periodEnd'],
                properties: {
                  specialistId: { type: 'string', format: 'uuid' },
                  periodStart: { type: 'string', format: 'date' },
                  periodEnd: { type: 'string', format: 'date' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Payout created' } },
      },
    },
    '/api/specialist-payouts/{id}/post': {
      post: {
        tags: ['Finance'],
        summary: 'Post specialist payout (creates GL entry)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['method'],
                properties: {
                  method: { type: 'string' },
                  paymentDate: { type: 'string', format: 'date' },
                },
              },
            },
          },
        },
        responses: { '200': { description: '{ payout, journalEntry }' } },
      },
    },
    '/api/payment-plans': {
      get: {
        tags: ['Finance'],
        summary: 'List all payment plans',
        responses: { '200': { description: 'Payment plan list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create payment plan',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'totalAmount', 'type'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  totalAmount: { type: 'number' },
                  type: { type: 'string', enum: ['fixed', 'flexible', 'one_time'] },
                  numberOfInstallments: { type: 'integer' },
                  amountPerInstallment: { type: 'number' },
                  startDate: { type: 'string', format: 'date' },
                },
              },
            },
          },
        },
        responses: { '201': { description: '{ plan, invoices, scheduleItems }' } },
      },
    },
    '/api/payment-plans/overdue': {
      get: {
        tags: ['Finance'],
        summary: 'Overdue and outstanding payment plans',
        description:
          'Both kinds unless ?status narrows it. overdueAmount is the instalments due so far minus the POSTED allocations to the plan.',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['overdue', 'outstanding'] },
          },
        ],
        responses: {
          '200': { description: 'Plans with overdueAmount' },
          '400': { description: 'status is not overdue or outstanding' },
        },
      },
    },
    '/api/payment-plans/outstanding': {
      get: {
        tags: ['Finance'],
        summary: 'Outstanding payment plans',
        responses: { '200': { description: 'Plans marked outstanding, with overdueAmount' } },
      },
    },
    '/api/payment-plans/{id}': {
      get: {
        tags: ['Finance'],
        summary: 'Payment plan detail',
        description:
          'The plan, its patient, the master invoice, totals {total, paid, balance} (paid = POSTED allocations to the plan invoices) and the payment history (each payment once; reversed ones shown but not counted; drafts left out).',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'The plan with totals and payment history' },
          '400': { description: 'id is not a UUID' },
          '404': { description: 'No such payment plan' },
        },
      },
    },
    '/api/payment-plans/patient/{patientId}': {
      get: {
        tags: ['Finance'],
        summary: 'Payment plans for a patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          { name: 'includeArchived', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: 'Patient payment plans' } },
      },
    },
    // ── Medical Records ────────────────────────────────────────────────────────
    '/api/medical-records': {
      get: {
        tags: ['Patients'],
        summary: 'List medical records',
        responses: { '200': { description: 'Medical record list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create medical record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  doctorId: { type: 'string', format: 'uuid' },
                  treatmentTypeId: { type: 'string', format: 'uuid' },
                  date: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Medical record created' } },
      },
    },
    '/api/medical-records/pending': {
      get: {
        tags: ['Patients'],
        summary: 'Pending medical records',
        parameters: [{ name: 'doctorId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Pending records' } },
      },
    },
    '/api/medical-records/{id}': {
      get: {
        tags: ['Patients'],
        summary: 'Get medical record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Medical record' } },
      },
      patch: {
        tags: ['Patients'],
        summary: 'Update medical record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated record' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete medical record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/medical-records/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Medical records for a patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Patient medical records' } },
      },
    },
    // ── Ortho Consent ──────────────────────────────────────────────────────────
    '/api/ortho-consent': {
      get: {
        tags: ['Patients'],
        summary: 'List ortho consent forms',
        parameters: [{ name: 'searchTerm', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Patients with consent forms' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create ortho consent form',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'consentFormUrl'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  consentFormUrl: { type: 'string', format: 'uri' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Consent created' } },
      },
    },
    // ── Patient Statements ─────────────────────────────────────────────────────
    '/api/patient-statements/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'List patient statements',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Statement list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Generate patient statement PDF',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fromDate', 'toDate'],
                properties: {
                  fromDate: { type: 'string', format: 'date-time' },
                  toDate: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { '200': { description: '{ ...statement, downloadUrl }' } },
      },
    },
    // ── Appointment Workflow ───────────────────────────────────────────────────
    '/api/appointment-workflow/{id}/transition': {
      patch: {
        tags: ['Appointments'],
        summary: 'Transition appointment state',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action'],
                properties: {
                  action: {
                    type: 'string',
                    enum: ['check-in', 'seat', 'complete', 'no-show', 'cancel'],
                  },
                  notes: { type: 'string' },
                  overrideReason: {
                    type: 'string',
                    description:
                      'Required (3+ chars) when an admin changes a visit from a previous day. Non-admins may only close out YESTERDAY as no-show or complete.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated appointment' },
          '403': { description: 'APPOINTMENT_PAST_LOCKED' },
          '409': {
            description:
              'APPOINTMENT_TERMINAL, or APPOINTMENT_INVALID_TRANSITION for a move the status machine does not allow',
          },
        },
      },
    },
    '/api/appointment-workflow/{id}/check-in': {
      post: {
        tags: ['Appointments'],
        summary: 'Check a patient in (payment, status and doctor note in one transaction)',
        description:
          'Give exactly one of payment, noPaymentReason or paymentRecordedElsewhere. A repeat for a visit already checked in is a success that takes no payment (alreadyCheckedIn: true).',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  payment: {
                    type: 'object',
                    required: ['amount', 'method'],
                    properties: {
                      amount: { type: 'number', description: 'Integer cents' },
                      method: { type: 'string' },
                      description: { type: 'string' },
                      treatments: { type: 'array', items: {} },
                      sendNotification: { type: 'boolean' },
                    },
                  },
                  noPaymentReason: { type: 'string', minLength: 3 },
                  paymentRecordedElsewhere: { type: 'boolean', enum: [true] },
                  overrideReason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              '{ appointment, payment, alreadyCheckedIn } plus smsError if the receipt SMS failed',
          },
          '400': {
            description:
              'CHECKIN_PAYMENT_MODE_REQUIRED, CHECKIN_PAYMENT_REJECTED or OVERRIDE_REASON_REQUIRED',
          },
          '403': {
            description:
              'No appointments:update (or payments:create when taking a payment), or APPOINTMENT_PAST_LOCKED',
          },
          '409': { description: 'APPOINTMENT_TERMINAL or APPOINTMENT_INVALID_TRANSITION' },
        },
      },
    },
    '/api/appointment-workflow/{id}/send-confirmation': {
      post: {
        tags: ['Appointments'],
        summary: 'Send confirmation SMS to patient',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: '{ smsSent, confirmationUrl }' } },
      },
    },
    // ── Doctors ────────────────────────────────────────────────────────────────
    '/api/doctors': {
      get: {
        tags: ['Staff'],
        summary: 'List doctors / specialists',
        responses: { '200': { description: 'Doctor list' } },
      },
    },
    '/api/doctors/unavailability': {
      get: {
        tags: ['Staff'],
        summary: 'Get doctor unavailability blocks',
        parameters: [{ name: 'doctorId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Unavailability blocks' } },
      },
      post: {
        tags: ['Staff'],
        summary: 'Create unavailability block',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['doctorId', 'startDate', 'endDate'],
                properties: {
                  doctorId: { type: 'string', format: 'uuid' },
                  startDate: { type: 'string', format: 'date-time' },
                  endDate: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Block created' } },
      },
    },
    '/api/doctors/unavailability/{id}': {
      delete: {
        tags: ['Staff'],
        summary: 'Delete unavailability block',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Treatments / Catalog ───────────────────────────────────────────────────
    '/api/treatments': {
      get: {
        tags: ['Services'],
        summary: 'List active treatment types',
        responses: { '200': { description: 'Treatment type list' } },
      },
    },
    '/api/services': {
      get: {
        tags: ['Services'],
        summary: 'List services',
        parameters: [
          {
            name: 'category',
            in: 'query',
            schema: { type: 'string', enum: ['clinic', 'xray', 'lab', 'insurance'] },
          },
          { name: 'activeOnly', in: 'query', schema: { type: 'boolean' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Service list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create service',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['category', 'name', 'amount'],
                properties: {
                  category: { type: 'string', enum: ['clinic', 'xray', 'lab', 'insurance'] },
                  name: { type: 'string' },
                  amount: { type: 'number' },
                  isActive: { type: 'boolean' },
                  additionalUnitPrice: {
                    type: 'integer',
                    minimum: 0,
                    nullable: true,
                    description:
                      'Pesewas for each unit after the first, applied while the application type has additionalUnitPriceEnabled. 400 when not a whole number of 0 or more.',
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Service created' } },
      },
    },
    '/api/services/{id}': {
      get: {
        tags: ['Services'],
        summary: 'Get service',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Service' } },
      },
      patch: {
        tags: ['Services'],
        summary: 'Update service (may create pending review)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated service or pending review (202)' } },
      },
    },
    '/api/services/{id}/doctors': {
      get: {
        tags: ['Services'],
        summary: 'Get doctors assigned to service',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Doctor-commission assignments' } },
      },
      put: {
        tags: ['Services'],
        summary: 'Update doctor assignments for service',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  doctors: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        doctorId: { type: 'string', format: 'uuid' },
                        commissionRate: { type: 'number' },
                        noCommission: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
    },
    // ── Compliance ─────────────────────────────────────────────────────────────
    '/api/compliance': {
      get: {
        tags: ['Compliance'],
        summary: 'List compliance documents',
        responses: { '200': { description: 'Compliance document list' } },
      },
      post: {
        tags: ['Compliance'],
        summary: 'Create compliance document',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['documentName', 'category'],
                properties: {
                  documentName: { type: 'string' },
                  category: { type: 'string' },
                  documentUrl: { type: 'string', format: 'uri' },
                  dateIssued: { type: 'string', format: 'date' },
                  dateExpired: { type: 'string', format: 'date' },
                  reminderEnabled: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Document created' } },
      },
    },
    '/api/compliance/{id}': {
      patch: {
        tags: ['Compliance'],
        summary: 'Update compliance document',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated document' } },
      },
      delete: {
        tags: ['Compliance'],
        summary: 'Delete compliance document',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Communications ─────────────────────────────────────────────────────────
    '/api/sms/send': {
      post: {
        tags: ['Communications'],
        summary: 'Send SMS',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['recipients', 'type'],
                properties: {
                  recipients: { type: 'array', items: { type: 'string' } },
                  from: { type: 'string' },
                  type: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'SMS send result' } },
      },
    },
    '/api/sms/messages': {
      get: {
        tags: ['Communications'],
        summary: 'SMS message history',
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Message list' } },
      },
    },
    '/api/push/subscribe': {
      post: {
        tags: ['Communications'],
        summary: 'Subscribe to push notifications',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['endpoint', 'keys'],
                properties: {
                  endpoint: { type: 'string' },
                  keys: {
                    type: 'object',
                    properties: { p256dh: { type: 'string' }, auth: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: '{ id }' } },
      },
    },
    '/api/push/send': {
      post: {
        tags: ['Communications'],
        summary: 'Send push notification',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userIds', 'title', 'body'],
                properties: {
                  userIds: { type: 'array', items: { type: 'string' } },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: '{ sent, removed, attempted }' } },
      },
    },
    '/api/reminder-templates': {
      get: {
        tags: ['Communications'],
        summary: 'List reminder templates',
        responses: { '200': { description: 'Template list' } },
      },
      post: {
        tags: ['Communications'],
        summary: 'Create reminder template',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'messageTemplate'],
                properties: { name: { type: 'string' }, messageTemplate: { type: 'string' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Template created' } },
      },
    },
    '/api/reminder-templates/{id}': {
      patch: {
        tags: ['Communications'],
        summary: 'Update reminder template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  messageTemplate: { type: 'string' },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated template' } },
      },
      delete: {
        tags: ['Communications'],
        summary: 'Delete reminder template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Patient Media ──────────────────────────────────────────────────────────
    '/api/patient-media/photos/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Patient photos',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Photo list' } },
      },
    },
    '/api/patient-media/photos': {
      post: {
        tags: ['Patients'],
        summary: 'Upload patient photo record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'imageUrl', 'category'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  imageUrl: { type: 'string', format: 'uri' },
                  category: { type: 'string', enum: ['intraoral', 'portrait', 'before', 'after'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Photo record created' } },
      },
    },
    '/api/patient-media/documents/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Patient documents',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Document list' } },
      },
    },
    // ── Sales ──────────────────────────────────────────────────────────────────
    '/api/sales': {
      get: {
        tags: ['Services'],
        summary: 'List store sales',
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'Sale list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Record store sale',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['productId', 'quantity', 'unitPrice', 'costPrice'],
                properties: {
                  productId: { type: 'string', format: 'uuid' },
                  quantity: { type: 'integer' },
                  unitPrice: { type: 'number' },
                  costPrice: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Sale recorded' } },
      },
    },
    // ── API Keys ───────────────────────────────────────────────────────────────
    '/api/api-keys': {
      get: {
        tags: ['System'],
        summary: 'List API keys',
        responses: { '200': { description: 'Key list (prefix only, no plaintext)' } },
      },
      post: {
        tags: ['System'],
        summary: 'Create API key',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['label', 'scope'],
                properties: {
                  label: { type: 'string' },
                  scope: { type: 'string', example: 'website_bookings.create' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: '{ id, label, keyPrefix, scope, plaintext } — plaintext shown once',
          },
        },
      },
    },
    '/api/api-keys/{id}/revoke': {
      post: {
        tags: ['System'],
        summary: 'Revoke API key',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Revoked' } },
      },
    },
    // ── Website Bookings ───────────────────────────────────────────────────────
    '/api/website-bookings': {
      get: {
        tags: ['Appointments'],
        summary: 'List website booking requests',
        responses: { '200': { description: 'Booking request list' } },
      },
      post: {
        tags: ['Appointments'],
        summary: 'Submit website booking (API key auth)',
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'phone'],
                properties: {
                  name: { type: 'string' },
                  phone: { type: 'string' },
                  email: { type: 'string' },
                  service: { type: 'string' },
                  preferredDate: { type: 'string', format: 'date' },
                  preferredTime: { type: 'string', example: '09:30' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Booking submitted' } },
      },
    },
    '/api/website-bookings/{id}/convert-to-appointment': {
      post: {
        tags: ['Appointments'],
        summary: 'Convert website booking to appointment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['doctorId'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  doctorId: { type: 'string', format: 'uuid' },
                  date: { type: 'string', format: 'date' },
                  time: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: '{ booking, appointment }' } },
      },
    },
    // ── Insurance ──────────────────────────────────────────────────────────────
    '/api/insurance/companies': {
      get: {
        tags: ['Finance'],
        summary: 'List insurance companies',
        responses: { '200': { description: 'Company list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create insurance company',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  contactEmail: { type: 'string' },
                  contactPhone: { type: 'string' },
                  address: { type: 'string' },
                  notes: { type: 'string' },
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Company created' } },
      },
    },
    '/api/insurance/companies/{id}': {
      get: {
        tags: ['Finance'],
        summary: 'Get insurance company',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Company with pricing documents' } },
      },
      patch: {
        tags: ['Finance'],
        summary: 'Update insurance company',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated company' } },
      },
      delete: {
        tags: ['Finance'],
        summary: 'Delete insurance company',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/insurance/pricing-documents': {
      post: {
        tags: ['Finance'],
        summary: 'Upload pricing document',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['companyId', 'fileUrl', 'fileName'],
                properties: {
                  companyId: { type: 'string', format: 'uuid' },
                  fileUrl: { type: 'string' },
                  fileName: { type: 'string' },
                  fileSize: { type: 'integer' },
                  mimeType: { type: 'string' },
                  isCurrent: { type: 'boolean' },
                  version: { type: 'string' },
                  effectiveFrom: { type: 'string', format: 'date' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Document uploaded' } },
      },
    },
    '/api/insurance/pricing-documents/{id}/set-current': {
      patch: {
        tags: ['Finance'],
        summary: 'Set pricing document as current',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Set as current' } },
      },
    },
    '/api/insurance/pricing-documents/{id}': {
      delete: {
        tags: ['Finance'],
        summary: 'Delete pricing document',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/insurance/reconciliation': {
      get: {
        tags: ['Finance'],
        summary: 'List insurance reconciliation records',
        parameters: [
          { name: 'companyId', in: 'query', schema: { type: 'string' } },
          { name: 'patientId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Reconciliation list' } },
      },
      post: {
        tags: ['Finance'],
        summary: 'Create reconciliation record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'companyId',
                  'patientId',
                  'cardNumber',
                  'treatmentSourceType',
                  'treatmentSourceId',
                  'chargedAmount',
                ],
                properties: {
                  companyId: { type: 'string', format: 'uuid' },
                  patientId: { type: 'string', format: 'uuid' },
                  cardNumber: { type: 'string' },
                  treatmentSourceType: { type: 'string' },
                  treatmentSourceId: { type: 'string' },
                  chargedAmount: { type: 'number' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Record created' } },
      },
    },
    '/api/insurance/reconciliation/patient/{patientId}': {
      get: {
        tags: ['Finance'],
        summary: 'Insurance reconciliation for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Patient reconciliation list' } },
      },
    },
    '/api/insurance/reconciliation/{id}': {
      patch: {
        tags: ['Finance'],
        summary: 'Update reconciliation record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { insurerPaidAmount: { type: 'number' }, notes: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated record' } },
      },
      delete: {
        tags: ['Finance'],
        summary: 'Delete reconciliation record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Inventory ──────────────────────────────────────────────────────────────
    '/api/inventory': {
      get: {
        tags: ['Services'],
        summary: 'List inventory items',
        responses: { '200': { description: 'Inventory list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create inventory item',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '201': { description: 'Item created' } },
      },
    },
    '/api/inventory/{id}': {
      get: {
        tags: ['Services'],
        summary: 'Get inventory item',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Inventory item' } },
      },
      patch: {
        tags: ['Services'],
        summary: 'Update inventory item',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated item' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete inventory item',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/inventory-locations': {
      get: {
        tags: ['Services'],
        summary: 'List inventory locations',
        responses: { '200': { description: 'Location list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create inventory location',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'code'],
                properties: {
                  name: { type: 'string' },
                  code: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Location created' } },
      },
    },
    '/api/inventory-locations/{id}': {
      patch: {
        tags: ['Services'],
        summary: 'Update inventory location',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated location' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete inventory location',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Labs ───────────────────────────────────────────────────────────────────
    '/api/labs/vendors': {
      get: {
        tags: ['Services'],
        summary: 'List lab vendors',
        responses: { '200': { description: 'Vendor list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create lab vendor',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'type'],
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  contactEmail: { type: 'string' },
                  contactPhone: { type: 'string' },
                  address: { type: 'string' },
                  notes: { type: 'string' },
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Vendor created' } },
      },
    },
    '/api/labs/vendors/{id}': {
      get: {
        tags: ['Services'],
        summary: 'Get lab vendor',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Vendor' } },
      },
      patch: {
        tags: ['Services'],
        summary: 'Update lab vendor',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated vendor' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete lab vendor',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/labs/vendors/{vendorId}/services': {
      get: {
        tags: ['Services'],
        summary: 'List vendor lab services',
        parameters: [
          {
            name: 'vendorId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Service list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Add service to vendor',
        parameters: [
          {
            name: 'vendorId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['baseServiceId'],
                properties: {
                  baseServiceId: { type: 'string', format: 'uuid' },
                  regularCost: { type: 'number' },
                  regularTurnaroundDays: { type: 'integer' },
                  notes: { type: 'string' },
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Service added' } },
      },
    },
    '/api/labs/services/{id}': {
      patch: {
        tags: ['Services'],
        summary: 'Update vendor lab service',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated service' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete vendor lab service',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/labs/services/{serviceId}/express-options': {
      post: {
        tags: ['Services'],
        summary: 'Add express option to lab service',
        parameters: [
          {
            name: 'serviceId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['label', 'cost', 'turnaroundDays'],
                properties: {
                  label: { type: 'string' },
                  cost: { type: 'number' },
                  turnaroundDays: { type: 'integer' },
                  sortOrder: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Express option added' } },
      },
    },
    '/api/labs/express-options/{id}': {
      patch: {
        tags: ['Services'],
        summary: 'Update express option',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated option' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete express option',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/labs/service-catalog': {
      get: {
        tags: ['Services'],
        summary: 'Lab service catalog (all vendors × services)',
        responses: { '200': { description: 'Full catalog' } },
      },
    },
    '/api/labs/base-services': {
      get: {
        tags: ['Services'],
        summary: 'List base lab service types',
        responses: { '200': { description: 'Base service list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create base lab service type',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  categoryId: { type: 'string', format: 'uuid' },
                  unitType: { type: 'string' },
                  standardTurnaroundDays: { type: 'integer' },
                  notes: { type: 'string' },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Base service created' } },
      },
    },
    '/api/labs/base-services/{id}': {
      patch: {
        tags: ['Services'],
        summary: 'Update base lab service',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete base lab service',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/labs/categories': {
      get: {
        tags: ['Services'],
        summary: 'List lab categories',
        responses: { '200': { description: 'Category list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create lab category',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' }, isActive: { type: 'boolean' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Category created' } },
      },
    },
    '/api/labs/categories/{id}': {
      patch: {
        tags: ['Services'],
        summary: 'Update lab category',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete lab category',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/labs/cases': {
      get: {
        tags: ['Services'],
        summary: 'List lab cases',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'vendorId', in: 'query', schema: { type: 'string' } },
          { name: 'patientId', in: 'query', schema: { type: 'string' } },
          { name: 'assignedTechnicianId', in: 'query', schema: { type: 'string' } },
          { name: 'domain', in: 'query', schema: { type: 'string' } },
          { name: 'referringDoctorId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Lab case list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create lab case',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['vendorId', 'serviceId'],
                properties: {
                  vendorId: { type: 'string', format: 'uuid' },
                  serviceId: { type: 'string', format: 'uuid' },
                  domain: { type: 'string' },
                  patientId: { type: 'string', format: 'uuid' },
                  referringDoctorId: { type: 'string', format: 'uuid' },
                  externalPatientName: { type: 'string' },
                  units: { type: 'integer' },
                  patientCharge: { type: 'number' },
                  expressOptionId: { type: 'string', format: 'uuid' },
                  sentAt: { type: 'string', format: 'date-time' },
                  expectedReturn: { type: 'string', format: 'date' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Lab case created' } },
      },
    },
    '/api/labs/cases/expense-ready': {
      get: {
        tags: ['Services'],
        summary: 'Lab cases ready for expense creation',
        responses: { '200': { description: 'Cases with receivedAt set, no expense yet' } },
      },
    },
    '/api/labs/cases/{id}': {
      get: {
        tags: ['Services'],
        summary: 'Get lab case',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Lab case with photos' } },
      },
      patch: {
        tags: ['Services'],
        summary: 'Update lab case',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated case' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete lab case',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/labs/cases/{id}/clear-expense': {
      post: {
        tags: ['Services'],
        summary: 'Mark lab case expense as cleared',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  amount: { type: 'number' },
                  date: { type: 'string', format: 'date' },
                  paymentMethod: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: '{ expense, caseId }' } },
      },
    },
    '/api/labs/cases/{id}/photos': {
      post: {
        tags: ['Services'],
        summary: 'Add photo to lab case',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['photoUrl', 'photoType'],
                properties: {
                  photoUrl: { type: 'string' },
                  photoType: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Photo added' } },
      },
    },
    '/api/labs/photos/{id}': {
      delete: {
        tags: ['Services'],
        summary: 'Delete lab case photo',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Messages ───────────────────────────────────────────────────────────────
    '/api/messages': {
      get: {
        tags: ['Staff'],
        summary: 'List staff messages (inbox)',
        responses: { '200': { description: 'Message list' } },
      },
      post: {
        tags: ['Staff'],
        summary: 'Send staff message',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['receiverId', 'content'],
                properties: {
                  receiverId: { type: 'string', format: 'uuid' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Message sent' } },
      },
    },
    // ── Odontogram ─────────────────────────────────────────────────────────────
    '/api/odontogram/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Get patient odontogram',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Tooth condition records' } },
      },
    },
    '/api/odontogram': {
      post: {
        tags: ['Patients'],
        summary: 'Create odontogram entry',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'toothNumber', 'surface', 'condition'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  toothNumber: { type: 'integer' },
                  surface: { type: 'string' },
                  condition: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Entry created' } },
      },
    },
    '/api/odontogram/{id}': {
      patch: {
        tags: ['Patients'],
        summary: 'Update odontogram entry',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated entry' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete odontogram entry',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Payroll ────────────────────────────────────────────────────────────────
    '/api/payroll/staff/{staffId}/components': {
      get: {
        tags: ['Staff'],
        summary: 'Get staff payroll components',
        parameters: [
          {
            name: 'staffId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Payroll component list' } },
      },
      post: {
        tags: ['Staff'],
        summary: 'Add payroll component to staff',
        parameters: [
          {
            name: 'staffId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type', 'name', 'amount'],
                properties: {
                  type: { type: 'string' },
                  name: { type: 'string' },
                  amount: { type: 'number' },
                  currency: { type: 'string' },
                  taxable: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Component added' } },
      },
    },
    '/api/payroll/components/{componentId}': {
      delete: {
        tags: ['Staff'],
        summary: 'Remove payroll component',
        parameters: [
          {
            name: 'componentId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/payroll/tax-brackets': {
      get: {
        tags: ['Staff'],
        summary: 'Get GRA tax brackets',
        parameters: [{ name: 'year', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: '{ year, rows }' } },
      },
    },
    '/api/payroll/runs': {
      get: {
        tags: ['Staff'],
        summary: 'List payroll runs',
        responses: { '200': { description: 'Payroll run list' } },
      },
      post: {
        tags: ['Staff'],
        summary: 'Create payroll run',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'payPeriodStart', 'payPeriodEnd'],
                properties: {
                  name: { type: 'string' },
                  payPeriodStart: { type: 'string', format: 'date' },
                  payPeriodEnd: { type: 'string', format: 'date' },
                  includeStaffIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Payroll run created' } },
      },
    },
    // ── Perio Chart ────────────────────────────────────────────────────────────
    '/api/perio-chart/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Get perio chart for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Grouped perio exams' } },
      },
    },
    '/api/perio-chart': {
      post: {
        tags: ['Patients'],
        summary: 'Record perio readings',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'examId', 'readings'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  examId: { type: 'string' },
                  readings: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        toothNumber: { type: 'integer' },
                        site: { type: 'string' },
                        pocketDepth: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: '{ examId, count }' } },
      },
    },
    '/api/perio-chart/exam/{examId}': {
      delete: {
        tags: ['Patients'],
        summary: 'Delete perio exam',
        parameters: [{ name: 'examId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Products ───────────────────────────────────────────────────────────────
    '/api/products': {
      get: {
        tags: ['Services'],
        summary: 'List store products',
        responses: { '200': { description: 'Product list' } },
      },
      post: {
        tags: ['Services'],
        summary: 'Create product',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '201': { description: 'Product created' } },
      },
    },
    '/api/products/{id}': {
      get: {
        tags: ['Services'],
        summary: 'Get product',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Product' } },
      },
      patch: {
        tags: ['Services'],
        summary: 'Update product',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated product' } },
      },
      delete: {
        tags: ['Services'],
        summary: 'Delete product',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Payment Reminders ──────────────────────────────────────────────────────
    '/api/reminders/payment/cooldown-status': {
      get: {
        tags: ['Communications'],
        summary: 'Check payment reminder cooldown status',
        parameters: [{ name: 'phones', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: '{ lastSentMap, cooldownHours }' } },
      },
    },
    '/api/reminders/payment': {
      post: {
        tags: ['Communications'],
        summary: 'Send payment reminder SMS',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientName', 'patientPhone', 'amountDue'],
                properties: {
                  patientName: { type: 'string' },
                  patientPhone: { type: 'string' },
                  amountDue: { type: 'number' },
                  isChild: { type: 'boolean' },
                  guardianPhone: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Reminder sent' } },
      },
    },
    // ── Scheduled Reminders ────────────────────────────────────────────────────
    '/api/scheduled-reminders': {
      get: {
        tags: ['Communications'],
        summary: 'List scheduled reminders',
        responses: { '200': { description: 'Scheduled reminder list' } },
      },
      post: {
        tags: ['Communications'],
        summary: 'Create scheduled reminder',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'type', 'triggerType', 'messageTemplate'],
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  triggerType: { type: 'string' },
                  triggerOffsetHours: { type: 'number' },
                  scheduledAt: { type: 'string', format: 'date-time' },
                  cronExpression: { type: 'string' },
                  messageTemplate: { type: 'string' },
                  isActive: { type: 'boolean' },
                  patientId: { type: 'string', format: 'uuid' },
                  templateId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Reminder created' } },
      },
    },
    '/api/scheduled-reminders/{id}': {
      patch: {
        tags: ['Communications'],
        summary: 'Update scheduled reminder',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated reminder' } },
      },
      delete: {
        tags: ['Communications'],
        summary: 'Delete scheduled reminder',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Settings ───────────────────────────────────────────────────────────────
    '/api/settings/locks': {
      get: {
        tags: ['System'],
        summary: 'Get module lock settings',
        responses: { '200': { description: '{ products, inventory, isAdmin }' } },
      },
    },
    '/api/settings/locks/{type}': {
      post: {
        tags: ['System'],
        summary: 'Set module lock',
        parameters: [
          {
            name: 'type',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['products', 'inventory'] },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['locked'],
                properties: { locked: { type: 'boolean' } },
              },
            },
          },
        },
        responses: { '200': { description: '{ isLocked }' } },
      },
    },
    '/api/settings/low-stock-threshold': {
      get: {
        tags: ['System'],
        summary: 'Get low-stock alert threshold',
        responses: { '200': { description: 'Threshold value' } },
      },
      post: {
        tags: ['System'],
        summary: 'Update low-stock threshold',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['threshold'],
                properties: { threshold: { type: 'integer' } },
              },
            },
          },
        },
        responses: { '200': { description: '{ threshold }' } },
      },
    },
    '/api/settings/kv/{key}': {
      get: {
        tags: ['System'],
        summary: 'Get KV setting',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Setting value' } },
      },
      put: {
        tags: ['System'],
        summary: 'Set KV setting',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['value'], properties: { value: {} } },
            },
          },
        },
        responses: { '200': { description: 'Saved' } },
      },
    },
    '/api/settings/appointment-alert-config': {
      get: {
        tags: ['System'],
        summary: 'Get appointment alert config',
        responses: { '200': { description: 'Alert config' } },
      },
      post: {
        tags: ['System'],
        summary: 'Update appointment alert config',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  durationMinutes: { type: 'integer' },
                  soundDataUrl: { type: 'string' },
                  soundName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated config' } },
      },
    },
    '/api/settings/hr-features': {
      get: {
        tags: ['System'],
        summary: 'Get HR feature flags',
        responses: {
          '200': { description: '{ rosterEnabled, orgChartEnabled, reviewCyclesEnabled }' },
        },
      },
    },
    // ── Specialists ────────────────────────────────────────────────────────────
    '/api/specialists': {
      get: {
        tags: ['Staff'],
        summary: 'List specialists',
        parameters: [{ name: 'includeInactive', in: 'query', schema: { type: 'boolean' } }],
        responses: { '200': { description: 'Specialist list' } },
      },
      post: {
        tags: ['Staff'],
        summary: 'Create specialist',
        description:
          'With a `password` (internal specialists) the doctor login and the specialist are ONE write: if any part fails nothing is kept and the same request can be retried. ' +
          'The e-mail is stored lower-case (Better Auth looks logins up that way). The login must change the admin-set password before doing anything else. ' +
          '`userId` links an existing login instead: it must exist (400) and not already belong to another specialist (409).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'specialistType'],
                properties: {
                  name: { type: 'string' },
                  specialty: { type: 'string' },
                  specialistType: { type: 'string' },
                  contactEmail: { type: 'string' },
                  contactPhone: { type: 'string' },
                  tin: { type: 'string' },
                  userId: { type: 'string', format: 'uuid' },
                  password: { type: 'string' },
                  pwaAccess: { type: 'boolean' },
                  portalAccess: { type: 'boolean' },
                  defaultCommissionRate: { type: 'number' },
                  withholdingTaxRate: { type: 'number' },
                  payoutMethod: { type: 'string' },
                  isActive: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Specialist created' },
          '400': {
            description:
              'Missing name, password under 10 characters, e-mail missing or invalid for a login, a commission/withholding rate outside 0–100, or an unknown `userId`',
          },
          '409': {
            description:
              'The e-mail already has a login (any capitalisation), or `userId` already belongs to another specialist',
          },
        },
      },
    },
    '/api/specialists/directory': {
      get: {
        tags: ['Staff'],
        summary: 'List active specialists for doctor pickers (redacted, no payout details)',
        description:
          'Requires `payments:read` OR `specialists:read`. Returns id, name, specialty, profileImage, specialistType, defaultCommissionRate, isActive.',
        responses: { '200': { description: 'Specialist directory' } },
      },
    },
    '/api/specialists/{id}': {
      get: {
        tags: ['Staff'],
        summary: 'Get specialist',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Specialist' } },
      },
      patch: {
        tags: ['Staff'],
        summary: 'Update specialist',
        description:
          '`specialistType` cannot be changed (400 `SPECIALIST_TYPE_LOCKED`) — use `POST /api/specialists/{id}/grant-login` to make an external specialist internal. ' +
          'Setting `isActive` deactivates/reactivates the specialist and suspends/restores their login; deactivating also requires `specialists:delete`.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated specialist' } },
      },
      delete: {
        tags: ['Staff'],
        summary: 'Deactivate specialist',
        description:
          'Soft-deactivates (the row is kept). Also suspends the linked login and ends its open sessions. Reactivate with `PATCH { isActive: true }`.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deactivated specialist' } },
      },
    },
    '/api/specialists/{id}/grant-login': {
      post: {
        tags: ['Staff'],
        summary: 'Grant a portal login to an existing specialist',
        description:
          'Requires `specialists:update` and `specialists:create`. Marks the specialist internal and creates a `doctor` login with portal scope. ' +
          'Creates no HR employment record; if one already exists it is linked to the new login. ' +
          'Refusals: 404 `NOT_FOUND`, 400 `INACTIVE`, 409 `ALREADY_HAS_LOGIN`, 409 `EMAIL_TAKEN`, 409 `STAFF_ALREADY_LINKED`.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 10 },
                  portalAccess: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '{ specialistId, userId, staffRowId, specialist }' },
          '400': { description: 'Invalid body, or the specialist is inactive' },
          '409': { description: 'Already has a login, or the email is taken' },
        },
      },
    },
    '/api/specialists/{id}/services': {
      get: {
        tags: ['Staff'],
        summary: 'Get specialist services',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Service list' } },
      },
    },
    // ── Staff Auth ─────────────────────────────────────────────────────────────
    '/api/staff-auth/device-trust-status': {
      get: {
        tags: ['Auth'],
        summary: 'Check staff device trust status',
        responses: { '200': { description: '{ trusted }' } },
      },
    },
    '/api/staff-auth/send-device-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Send staff device OTP',
        responses: { '200': { description: '{ phoneHint }' } },
      },
    },
    '/api/staff-auth/verify-device-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Verify staff device OTP',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: { code: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Verified' } },
      },
    },
    '/api/staff-auth/forget-this-device': {
      post: {
        tags: ['Auth'],
        summary: 'Remove device trust for current staff session',
        responses: { '200': { description: 'Device trust cleared' } },
      },
    },
    '/api/staff-auth/clear-first-login': {
      post: {
        tags: ['Auth'],
        summary: 'Clear staff first-login flag',
        responses: { '200': { description: 'Flag cleared' } },
      },
    },
    // ── Staff Credentials ──────────────────────────────────────────────────────
    '/api/staff-credentials': {
      get: {
        tags: ['Staff'],
        summary: 'List staff credentials',
        parameters: [{ name: 'staffId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Credential list' } },
      },
      post: {
        tags: ['Staff'],
        summary: 'Create staff credential',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['staffId', 'credentialType', 'credentialName'],
                properties: {
                  staffId: { type: 'string', format: 'uuid' },
                  credentialType: { type: 'string' },
                  credentialName: { type: 'string' },
                  issuingBody: { type: 'string' },
                  issueDate: { type: 'string', format: 'date' },
                  expiryDate: { type: 'string', format: 'date' },
                  documentUrl: { type: 'string' },
                  notes: { type: 'string' },
                  reminderDaysBefore: { type: 'integer' },
                  reminderEnabled: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Credential created' } },
      },
    },
    '/api/staff-credentials/expiring': {
      get: {
        tags: ['Staff'],
        summary: 'List expiring staff credentials',
        responses: { '200': { description: 'Credentials expiring within reminder window' } },
      },
    },
    '/api/staff-credentials/{id}': {
      patch: {
        tags: ['Staff'],
        summary: 'Update staff credential',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated credential' } },
      },
      delete: {
        tags: ['Staff'],
        summary: 'Delete staff credential',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Wallet ─────────────────────────────────────────────────────────────────
    '/api/wallet/patient/{patientId}': {
      get: {
        tags: ['Finance'],
        summary: 'Get patient wallet balance and transactions',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: '{ wallet, transactions }' } },
      },
    },
    '/api/wallet/patient/{patientId}/credit': {
      post: {
        tags: ['Finance'],
        summary: 'Credit patient wallet',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: { amount: { type: 'number' }, description: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: '{ wallet, transaction }' } },
      },
    },
    '/api/wallet/patient/{patientId}/allocate': {
      post: {
        tags: ['Finance'],
        summary: 'Allocate wallet balance to invoice',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['invoiceId', 'amount'],
                properties: {
                  invoiceId: { type: 'string', format: 'uuid' },
                  amount: { type: 'number' },
                },
              },
            },
          },
        },
        responses: { '200': { description: '{ settled }' } },
      },
    },
    // ── X-Rays ─────────────────────────────────────────────────────────────────
    '/api/xrays/types': {
      get: {
        tags: ['Patients'],
        summary: 'List X-ray types',
        responses: { '200': { description: 'X-ray type list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create X-ray type',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'displayName'],
                properties: {
                  name: { type: 'string' },
                  displayName: { type: 'string' },
                  description: { type: 'string' },
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Type created' } },
      },
    },
    '/api/xrays/types/{id}': {
      patch: {
        tags: ['Patients'],
        summary: 'Update X-ray type',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated type' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete X-ray type',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/xrays': {
      get: {
        tags: ['Patients'],
        summary: 'List all X-ray records',
        responses: { '200': { description: 'X-ray record list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create X-ray record',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'imageUrl'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  imageUrl: { type: 'string' },
                  xrayTypeId: { type: 'string', format: 'uuid' },
                  source: { type: 'string' },
                  toothNumber: { type: 'integer' },
                  thumbnailUrl: { type: 'string' },
                  capturedAt: { type: 'string', format: 'date-time' },
                  externalClinicName: { type: 'string' },
                  externalCapturedDate: { type: 'string', format: 'date' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'X-ray created' } },
      },
    },
    '/api/xrays/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Get X-rays for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Patient X-ray list' } },
      },
    },
    '/api/xrays/{id}': {
      get: {
        tags: ['Patients'],
        summary: 'Get X-ray record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'X-ray record' } },
      },
      patch: {
        tags: ['Patients'],
        summary: 'Update X-ray record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated X-ray' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete X-ray record',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/xrays/share': {
      post: {
        tags: ['Patients'],
        summary: 'Create X-ray share link',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['xrayRecordIds', 'recipientName'],
                properties: {
                  xrayRecordIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  recipientName: { type: 'string' },
                  recipientContact: { type: 'string' },
                  expiryDays: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: '{ id, shareUrl, accessCode, expiresAt, preformattedMessage }' },
        },
      },
    },
    '/api/xrays/share-links/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'List X-ray share links for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Share link list' } },
      },
    },
    '/api/xrays/share-links/{id}/revoke': {
      patch: {
        tags: ['Patients'],
        summary: 'Revoke X-ray share link',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Revoked' } },
      },
    },
    '/api/xrays/public/share/{token}': {
      get: {
        tags: ['Patients'],
        summary: 'Get public X-ray share metadata',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        security: [],
        responses: {
          '200': { description: '{ recipientName, firstName, expiresAt, requiresCode }' },
        },
      },
    },
    '/api/xrays/public/share/{token}/verify': {
      post: {
        tags: ['Patients'],
        summary: 'Verify share access code and get X-rays',
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: { code: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'X-ray records for recipient' } },
      },
    },
    // ── Patient Auth ───────────────────────────────────────────────────────────
    '/api/patient-auth/device-trust-status': {
      get: {
        tags: ['Auth'],
        summary: 'Check patient device trust status',
        responses: { '200': { description: '{ trusted }' } },
      },
    },
    '/api/patient-auth/send-device-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Send patient device OTP',
        responses: { '200': { description: '{ phoneHint }' } },
      },
    },
    '/api/patient-auth/verify-device-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Verify patient device OTP',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: { code: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Verified' } },
      },
    },
    '/api/patient-auth/forget-this-device': {
      post: {
        tags: ['Auth'],
        summary: 'Remove device trust for patient session',
        responses: { '200': { description: 'Cleared' } },
      },
    },
    '/api/patient-auth/clear-first-login': {
      post: {
        tags: ['Auth'],
        summary: 'Clear patient first-login flag',
        responses: { '200': { description: 'Flag cleared' } },
      },
    },
    // ── Patient Cases ──────────────────────────────────────────────────────────
    '/api/patient-cases/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'List patient lab cases (patient-facing)',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Lab case list' } },
      },
    },
    '/api/patient-cases/patient/{patientId}/prescriptions': {
      get: {
        tags: ['Patients'],
        summary: 'Get prescriptions for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Prescription list' } },
      },
    },
    // ── Patient Portal ─────────────────────────────────────────────────────────
    '/api/patient-portal/appointments': {
      get: {
        tags: ['Patients'],
        summary: 'Patient portal: upcoming appointments',
        responses: { '200': { description: 'Appointment list for logged-in patient' } },
      },
    },
    '/api/patient-portal/records': {
      get: {
        tags: ['Patients'],
        summary: 'Patient portal: medical records',
        responses: { '200': { description: 'Medical records for logged-in patient' } },
      },
    },
    '/api/patient-portal/payments': {
      get: {
        tags: ['Patients'],
        summary: 'Patient portal: invoices and wallet',
        responses: { '200': { description: '{ invoices, wallet, transactions }' } },
      },
    },
    '/api/patient-portal/profile': {
      get: {
        tags: ['Patients'],
        summary: 'Patient portal: get profile',
        responses: { '200': { description: 'Patient profile' } },
      },
      patch: {
        tags: ['Patients'],
        summary: 'Patient portal: update profile',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated profile' } },
      },
    },
    // ── Patient Reminders ──────────────────────────────────────────────────────
    '/api/patient-reminders': {
      get: {
        tags: ['Patients'],
        summary: 'List patient reminders',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'dueBefore', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'assignedToMe', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: '{ data, total }' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create patient reminder',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'reminderDate'],
                properties: {
                  title: { type: 'string' },
                  reminderDate: { type: 'string', format: 'date-time' },
                  notes: { type: 'string' },
                  patientId: { type: 'string', format: 'uuid' },
                  targetType: { type: 'string' },
                  targetSpecialistId: { type: 'string', format: 'uuid' },
                  assignedToId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Reminder created' } },
      },
    },
    '/api/patient-reminders/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Get reminders for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Reminder list' } },
      },
    },
    '/api/patient-reminders/{id}': {
      patch: {
        tags: ['Patients'],
        summary: 'Update patient reminder',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated reminder' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete patient reminder',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Patient Timeline ───────────────────────────────────────────────────────
    '/api/patient-timeline/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Get patient timeline',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Timeline events' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Add patient timeline event',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  eventType: { type: 'string' },
                  referenceType: { type: 'string' },
                  referenceId: { type: 'string' },
                  description: { type: 'string' },
                  amount: { type: 'number' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Event added' } },
      },
    },
    // ── Treatment Plans ────────────────────────────────────────────────────────
    '/api/treatment-plans': {
      get: {
        tags: ['Patients'],
        summary: 'List treatment plans',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Treatment plan list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create treatment plan',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patientId', 'title', 'items'],
                properties: {
                  patientId: { type: 'string', format: 'uuid' },
                  title: { type: 'string' },
                  notes: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        procedureName: { type: 'string' },
                        toothNumber: { type: 'integer' },
                        phase: { type: 'integer' },
                        estimatedCost: { type: 'number' },
                        treatmentTypeId: { type: 'string', format: 'uuid' },
                        notes: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Treatment plan created' } },
      },
    },
    '/api/treatment-plans/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Get treatment plans for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Plans with items' } },
      },
    },
    '/api/treatment-plans/{id}': {
      get: {
        tags: ['Patients'],
        summary: 'Get treatment plan',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: '{ plan, items }' } },
      },
    },
    // ── Consent Forms ──────────────────────────────────────────────────────────
    '/api/consent-forms/templates': {
      get: {
        tags: ['Patients'],
        summary: 'List consent form templates',
        responses: { '200': { description: 'Template list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create consent form template',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'content'],
                properties: {
                  name: { type: 'string' },
                  content: { type: 'string' },
                  category: { type: 'string' },
                  requiresSignature: { type: 'boolean' },
                  requiresWitness: { type: 'boolean' },
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Template created' } },
      },
    },
    '/api/consent-forms/templates/{id}': {
      get: {
        tags: ['Patients'],
        summary: 'Get consent form template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Template' } },
      },
      patch: {
        tags: ['Patients'],
        summary: 'Update consent form template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated template' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete consent form template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/consent-forms/signed/patient/{patientId}': {
      get: {
        tags: ['Patients'],
        summary: 'Get signed consent forms for patient',
        parameters: [
          {
            name: 'patientId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Signed form list' } },
      },
    },
    '/api/consent-forms/signed/{id}': {
      get: {
        tags: ['Patients'],
        summary: 'Get signed consent form',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Signed form' } },
      },
    },
    '/api/consent-forms/signed': {
      post: {
        tags: ['Patients'],
        summary: 'Submit signed consent form',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['templateId', 'patientId', 'signatureData', 'signedByName'],
                properties: {
                  templateId: { type: 'string', format: 'uuid' },
                  patientId: { type: 'string', format: 'uuid' },
                  signatureData: { type: 'string' },
                  signedByName: { type: 'string' },
                  relationshipToPatient: { type: 'string' },
                  witnessName: { type: 'string' },
                  witnessSignatureData: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Signed form submitted' } },
      },
    },
    // ── Consent Templates (PDF) ────────────────────────────────────────────────
    '/api/consent-templates': {
      get: {
        tags: ['Patients'],
        summary: 'List PDF consent templates',
        responses: { '200': { description: 'PDF template list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create PDF consent template',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  description: { type: 'string' },
                  pdfUrl: { type: 'string' },
                  pdfKey: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Template created' } },
      },
    },
    '/api/consent-templates/{id}': {
      patch: {
        tags: ['Patients'],
        summary: 'Update PDF consent template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated template' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete PDF consent template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── CRM ────────────────────────────────────────────────────────────────────
    '/api/crm/follow-ups': {
      get: {
        tags: ['Patients'],
        summary: 'CRM follow-up queue',
        responses: { '200': { description: 'Patients due for follow-up' } },
      },
    },
    '/api/crm/recalls': {
      get: {
        tags: ['Patients'],
        summary: 'CRM recall list',
        responses: { '200': { description: 'Patients due for recall / reactivation' } },
      },
    },
    '/api/crm/birthdays': {
      get: {
        tags: ['Patients'],
        summary: 'CRM birthday list (upcoming)',
        responses: { '200': { description: 'Patients with upcoming birthdays' } },
      },
    },
    '/api/crm/ad-templates': {
      get: {
        tags: ['Patients'],
        summary: 'List CRM ad templates',
        responses: { '200': { description: 'Ad template list' } },
      },
      post: {
        tags: ['Patients'],
        summary: 'Create CRM ad template',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'body'],
                properties: { name: { type: 'string' }, body: { type: 'string' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Template created' } },
      },
    },
    '/api/crm/ad-templates/{id}': {
      patch: {
        tags: ['Patients'],
        summary: 'Update CRM ad template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated template' } },
      },
      delete: {
        tags: ['Patients'],
        summary: 'Delete CRM ad template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Google Calendar ────────────────────────────────────────────────────────
    '/api/google-calendar/status': {
      get: {
        tags: ['System'],
        summary: 'Google Calendar integration status',
        responses: {
          '200': { description: '{ configured, connected, email, connectedAt, calendarId }' },
        },
      },
    },
    '/api/google-calendar/per-doctor-status': {
      get: {
        tags: ['System'],
        summary: 'Per-doctor Google Calendar sync status',
        responses: { '200': { description: '{ sharedFallbackCalendarId, rows }' } },
      },
    },
    '/api/google-calendar/appointment-sync/{appointmentId}': {
      get: {
        tags: ['System'],
        summary: 'Get appointment Google Calendar sync info',
        parameters: [
          {
            name: 'appointmentId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': { description: '{ method, configured, doctorConnected, eventLinked, syncedAt }' },
        },
      },
    },
    '/api/google-calendar/appointment-sync/{appointmentId}/resync': {
      post: {
        tags: ['System'],
        summary: 'Resync appointment to Google Calendar',
        parameters: [
          {
            name: 'appointmentId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'Resynced' } },
      },
    },
    '/api/google-calendar/connect': {
      get: {
        tags: ['System'],
        summary: 'Initiate Google Calendar OAuth flow',
        responses: { '302': { description: 'Redirect to Google OAuth' } },
      },
    },
    '/api/google-calendar/callback': {
      get: {
        tags: ['System'],
        summary: 'Google Calendar OAuth callback',
        parameters: [
          { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'state', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '302': { description: 'Redirect back to portal' } },
      },
    },
    '/api/google-calendar': {
      delete: {
        tags: ['System'],
        summary: 'Disconnect Google Calendar',
        responses: { '200': { description: '{ disconnected }' } },
      },
    },
    '/api/google-calendar/oauth-config': {
      get: {
        tags: ['System'],
        summary: 'Get Google OAuth config status',
        responses: { '200': { description: 'Config status' } },
      },
      put: {
        tags: ['System'],
        summary: 'Update Google OAuth config',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['clientId', 'redirectUri'],
                properties: {
                  clientId: { type: 'string' },
                  clientSecret: { type: 'string' },
                  redirectUri: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated config' } },
      },
      delete: {
        tags: ['System'],
        summary: 'Remove Google OAuth config',
        responses: { '200': { description: 'Removed' } },
      },
    },
    '/api/google-calendar/auth-method': {
      get: {
        tags: ['System'],
        summary: 'Get Google Calendar auth method',
        responses: { '200': { description: '{ method }' } },
      },
      put: {
        tags: ['System'],
        summary: 'Set Google Calendar auth method',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['method'],
                properties: { method: { type: 'string', enum: ['oauth', 'service_account'] } },
              },
            },
          },
        },
        responses: { '200': { description: '{ method }' } },
      },
    },
    '/api/google-calendar/service-account-config': {
      get: {
        tags: ['System'],
        summary: 'Get service account config status',
        responses: { '200': { description: 'Config status' } },
      },
      put: {
        tags: ['System'],
        summary: 'Update service account config',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  clientEmail: { type: 'string' },
                  privateKey: { type: 'string' },
                  calendarId: { type: 'string' },
                  jsonKey: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated config' } },
      },
      delete: {
        tags: ['System'],
        summary: 'Remove service account config',
        responses: { '200': { description: 'Removed' } },
      },
    },
    '/api/google-calendar/service-account-config/test': {
      post: {
        tags: ['System'],
        summary: 'Test service account connection',
        responses: { '200': { description: '{ ok, reason?, detail? }' } },
      },
    },
    '/api/google-calendar/shares': {
      get: {
        tags: ['System'],
        summary: 'List Google Calendar sharing rules',
        responses: { '200': { description: 'Share rule list' } },
      },
      post: {
        tags: ['System'],
        summary: 'Add Google Calendar sharing rules',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['emails'],
                properties: {
                  emails: { type: 'array', items: { type: 'string', format: 'email' } },
                  role: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Share results' } },
      },
    },
    '/api/google-calendar/shares/{ruleId}': {
      delete: {
        tags: ['System'],
        summary: 'Remove Google Calendar sharing rule',
        parameters: [{ name: 'ruleId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Removed' } },
      },
    },
    // ── Document Tags ──────────────────────────────────────────────────────────
    '/api/document-tags': {
      get: {
        tags: ['System'],
        summary: 'List document tags',
        responses: { '200': { description: 'Tag list' } },
      },
      post: {
        tags: ['System'],
        summary: 'Create document tag',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'displayName'],
                properties: {
                  name: { type: 'string' },
                  displayName: { type: 'string' },
                  color: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Tag created' } },
      },
    },
    '/api/document-tags/{id}': {
      patch: {
        tags: ['System'],
        summary: 'Update document tag',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated tag' } },
      },
      delete: {
        tags: ['System'],
        summary: 'Delete document tag',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Compliance Categories ──────────────────────────────────────────────────
    '/api/compliance-categories': {
      get: {
        tags: ['System'],
        summary: 'List compliance categories',
        responses: { '200': { description: 'Category list' } },
      },
      post: {
        tags: ['System'],
        summary: 'Create compliance category',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  color: { type: 'string' },
                  iconName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Category created' } },
      },
    },
    '/api/compliance-categories/{id}': {
      patch: {
        tags: ['System'],
        summary: 'Update compliance category',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '200': { description: 'Updated category' } },
      },
      delete: {
        tags: ['System'],
        summary: 'Delete compliance category',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Daily Reports ──────────────────────────────────────────────────────────
    '/api/reports': {
      get: {
        tags: ['Analytics'],
        summary: 'List daily clinical reports',
        responses: { '200': { description: 'Report list' } },
      },
      post: {
        tags: ['Analytics'],
        summary: 'Create daily clinical report',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reportDate: { type: 'string', format: 'date' },
                  inventoryUsed: { type: 'array', items: { type: 'object' } },
                  productsSold: { type: 'array', items: { type: 'object' } },
                  saleIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  expenseIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Report created' } },
      },
    },
    // ── Reports Injection ──────────────────────────────────────────────────────
    '/api/reports-injection': {
      get: {
        tags: ['Analytics'],
        summary: 'Get reports section visibility config',
        responses: { '200': { description: 'Normalized section config list' } },
      },
    },
    '/api/reports-injection/{section}': {
      put: {
        tags: ['Analytics'],
        summary: 'Update report section visibility',
        parameters: [{ name: 'section', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['enabled'],
                properties: { enabled: { type: 'boolean' }, config: { type: 'object' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated section config' } },
      },
    },
  },
} as const
