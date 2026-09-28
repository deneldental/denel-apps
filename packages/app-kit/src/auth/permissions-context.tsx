import { createContext, useContext } from 'react'

export type PermissionsPayload = {
  roleId?: string | null
  isAdmin: boolean
  scopes: string[]
  accessibleModules: string[]
}

const PermissionsContext = createContext<PermissionsPayload | null>(null)

export const PermissionsProvider = PermissionsContext.Provider

export function usePermissions(): PermissionsPayload | null {
  return useContext(PermissionsContext)
}
