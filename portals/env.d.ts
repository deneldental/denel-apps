/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_BETTER_AUTH_URL: string
  readonly VITE_APP_URL: string
  readonly VITE_CLINIC_NAME: string
  readonly VITE_CLINIC_PHONE: string
  readonly VITE_CLINIC_ADDRESS: string
  readonly VITE_GOOGLE_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
