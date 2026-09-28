import { Boxes } from 'lucide-react'
import { Route } from 'react-router-dom'
import { InventoryLayout } from '@/features/inventory/inventory-layout'
import BreakfastTrackingPage from '@/features/inventory/pages/breakfast'
import InventoryDetailPage from '@/features/inventory/pages/detail'
import InventoryPage from '@/features/inventory/pages/index'
import MonthlyThresholdPage from '@/features/inventory/pages/monthly-threshold'
import ProductDetailPage from '@/features/products/pages/product-detail'
import ProductInventoryPage from '@/features/products/pages/product-inventory'
import SupplierDetailPage from '@/features/store/pages/supplier-detail'
import SuppliersListPage from '@/features/store/pages/suppliers'
import { AdminRoute } from '@/shared/components/admin-route'
import type { Module } from './types'

export const inventoryModule: Module = {
  id: 'inventory',
  label: 'Inventory',
  order: 8.0,
  disallowedRoles: ['doctor'],
  hasAccess: (can) => can('inventory', 'update'),
  routes: [
    <Route key="inventory-layout" element={<InventoryLayout />}>
      <Route path="/inventory" element={<InventoryPage />} />
      <Route path="/inventory/products" element={<ProductInventoryPage />} />
      <Route path="/inventory/products/:id" element={<ProductDetailPage />} />
      <Route path="/inventory/suppliers" element={<SuppliersListPage />} />
      <Route path="/inventory/suppliers/:id" element={<SupplierDetailPage />} />
      <Route path="/inventory/monthly-threshold" element={<MonthlyThresholdPage />} />
      <Route
        path="/inventory/breakfast"
        element={
          <AdminRoute>
            <BreakfastTrackingPage />
          </AdminRoute>
        }
      />
      <Route path="/inventory/:id" element={<InventoryDetailPage />} />
    </Route>,
  ],
  navItems: [
    {
      label: 'Inventory',
      to: '/inventory',
      icon: Boxes,
    },
  ],
}
