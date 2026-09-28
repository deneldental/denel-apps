/**
 * Type-only re-export from the backend schema.
 * These imports are erased at build time — no runtime DB access occurs in the browser.
 * The canonical schema lives in backend/src/db/schema.ts.
 */
export type * from '../../../../backend/src/db/schema'
