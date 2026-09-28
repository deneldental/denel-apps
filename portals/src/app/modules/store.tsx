import { ShoppingBag } from 'lucide-react'
import { Route } from 'react-router-dom'
import ProductsPage from '@/features/products/pages/index'
import SalesReportsPage from '@/features/products/pages/sales'
import SalesReportDetailPage from '@/features/products/pages/sales-detail'
import { StoreLayout } from '@/features/store/store-layout'
import type { Module } from './types'

export const storeModule: Module = {
  id: 'store',
  label: 'Store',
  order: 7.0,
  disallowedRoles: ['doctor'],
  hasAccess: (can) => can('products', 'update'),
  routes: [
    <Route key="store-layout" element={<StoreLayout />}>
      <Route path="/products" element={<ProductsPage />} />
      <Route path="/store/sales" element={<SalesReportsPage />} />
      <Route path="/store/sales/:date" element={<SalesReportDetailPage />} />
    </Route>,
  ],
  navItems: [
    {
      label: 'Store',
      to: '/products',
      icon: ShoppingBag,
    },
  ],
}
