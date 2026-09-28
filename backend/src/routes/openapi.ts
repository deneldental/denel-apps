import { swaggerUI } from '@hono/swagger-ui'
import { Hono } from 'hono'
import { openapiSpec } from '../lib/openapi-spec'
import type { HonoEnv } from '../lib/types'

const openapiApp = new Hono<HonoEnv>()

// Machine-readable spec — consumed by API clients, codegen tools, Postman
openapiApp.get('/openapi.json', (c) => {
  return c.json(openapiSpec)
})

// Swagger UI — human-browsable docs at /api/docs
openapiApp.get('/docs', swaggerUI({ url: '/api/openapi.json', title: 'Denel API Docs' }))

export { openapiApp }
