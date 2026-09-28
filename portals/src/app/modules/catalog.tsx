import { PackageSearch } from 'lucide-react'
import { Route } from 'react-router-dom'
import CatalogPage from '@/features/catalog/pages/index'
import type { Module } from './types'

// Unified item catalog (admin-v1 §12.1). Gated on the `items` module — grants
// mirrored from inventory/products by migration 0101 (staging-verified).
export const catalogModule: Module = {
  id: 'catalog',
  label: 'Catalog',
  order: 9.0,
  permission: 'items',
  routes: [<Route key="catalog" path="/catalog" element={<CatalogPage />} />],
  navItems: [
    {
      label: 'Catalog',
      to: '/catalog',
      icon: PackageSearch,
    },
  ],
}
