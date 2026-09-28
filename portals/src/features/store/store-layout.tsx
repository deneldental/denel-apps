import { ShoppingBag, Tag } from 'lucide-react'
import { type MiniSidebarItem, MiniSidebarLayout } from '@/shared/components/mini-sidebar-layout'

const STORE_NAV: MiniSidebarItem[] = [
  { label: 'Products', to: '/products', icon: ShoppingBag },
  { label: 'Sales Reports', to: '/store/sales', icon: Tag },
]

export function StoreLayout() {
  return <MiniSidebarLayout title="Store" items={STORE_NAV} />
}
