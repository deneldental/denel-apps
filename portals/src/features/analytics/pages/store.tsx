import {
  AlertTriangle,
  Banknote,
  Boxes,
  Clock,
  Coins,
  type LucideIcon,
  Package,
  PackageX,
  TrendingDown,
  Users,
} from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAnalyticsPeriod } from '@/features/analytics/period-context'
import {
  buildPeriodQuery,
  getStoreExpenses,
  getStoreInventoryAging,
  getStoreSuppliers,
  type StoreExpensesAnalytics,
  type StoreInventoryAgingAnalytics,
  type StoreSuppliersAnalytics,
} from '@/lib/actions/analytics'
import { useApiQuery } from '@/lib/query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatAmount } from '@/shared/utils/currency'

const STORE_SUPPLIERS_KEY = (period: string) => ['analytics', 'store', 'suppliers', period] as const
const STORE_EXPENSES_KEY = (period: string) => ['analytics', 'store', 'expenses', period] as const
const STORE_INVENTORY_AGING_KEY = (period: string) =>
  ['analytics', 'store', 'inventory-aging', period] as const

const GHS = (n: number) => `GHS ${formatAmount(n)}`
const GHS_COMPACT = (n: number) => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `GHS ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `GHS ${(n / 1_000).toFixed(1)}K`
  return GHS(n)
}

interface TileProps {
  label: string
  value: string
  icon: LucideIcon
  subText?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
}
const TONE_RING: Record<NonNullable<TileProps['tone']>, string> = {
  default: 'border-border',
  success: 'border-emerald-200 bg-emerald-50/30',
  warning: 'border-amber-200 bg-amber-50/30',
  danger: 'border-red-200 bg-red-50/30',
}
const TONE_ICON: Record<NonNullable<TileProps['tone']>, string> = {
  default: 'bg-muted text-foreground',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
}
function Tile({ label, value, icon: Icon, subText, tone = 'default' }: TileProps) {
  return (
    <div className={`rounded-xl border ${TONE_RING[tone]} p-4 flex flex-col gap-2`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <p className="text-xl font-bold mt-0.5 leading-tight">{value}</p>
        {subText && <p className="text-[11px] text-muted-foreground mt-0.5">{subText}</p>}
      </div>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

function PageLoader() {
  return <div className="h-72 rounded-xl border bg-muted/30 animate-pulse" />
}

const TAB_IDS = ['inventory', 'suppliers', 'expenses'] as const
type TabId = (typeof TAB_IDS)[number]

export default function StoreAnalyticsPage({ printMode = false }: { printMode?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as TabId | null
  const activeTab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'suppliers'

  function setTab(t: TabId) {
    const next = new URLSearchParams(searchParams)
    if (t === 'suppliers') next.delete('tab')
    else next.set('tab', t)
    setSearchParams(next, { replace: true })
  }

  if (printMode) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Store / Supply Chain</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inventory health, supplier concentration, A/P aging, expense categories.
          </p>
        </header>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Suppliers &amp; A/P</h2>
          <SuppliersTab />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Expenses</h2>
          <ExpensesTab />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold border-b pb-1">Inventory aging</h2>
          <InventoryAgingTab />
        </section>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Store / Supply Chain</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Supplier exposure, A/P aging, expense categories and inventory aging.
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)} className="space-y-4">
        <TabsList>
          <TabsTrigger value="suppliers">Suppliers &amp; A/P</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="inventory">Inventory aging</TabsTrigger>
        </TabsList>
        <TabsContent value="suppliers" className="space-y-4">
          <SuppliersTab />
        </TabsContent>
        <TabsContent value="expenses" className="space-y-4">
          <ExpensesTab />
        </TabsContent>
        <TabsContent value="inventory" className="space-y-4">
          <InventoryAgingTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Suppliers & A/P ────────────────────────────────────────────────────────

function SuppliersTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(STORE_SUPPLIERS_KEY(periodQuery), () => getStoreSuppliers(periodQuery))
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (loading || !data) return <PageLoader />
  if (error)
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    )

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile
          label="A/P outstanding"
          value={GHS_COMPACT(data.tiles.totalAPOutstanding)}
          icon={Coins}
          subText={`${data.tiles.activeSuppliers} active suppliers`}
        />
        <Tile
          label="A/P overdue"
          value={GHS_COMPACT(data.tiles.overdueAP)}
          icon={AlertTriangle}
          tone={data.tiles.overdueAP > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Days payable outstanding"
          value={`${data.tiles.dpo} days`}
          icon={Clock}
          subText={`Over ${data.windowDays}-day window`}
        />
        <Tile
          label="Top-5 supplier share"
          value={`${data.tiles.top5SharePct}%`}
          icon={Users}
          subText={`Top supplier: ${data.tiles.topSupplierSharePct}%`}
          tone={data.tiles.top5SharePct > 70 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="A/P aging buckets">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.apBuckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
              <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
              <Bar dataKey="balance" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Top supplier spend concentration">
          {data.concentration.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No supplier bills posted in the selected window.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Supplier</th>
                  <th className="text-right font-medium pb-1">Bills</th>
                  <th className="text-right font-medium pb-1">Spend</th>
                  <th className="text-right font-medium pb-1">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.concentration.slice(0, 10).map((s) => (
                  <tr key={s.supplierId ?? s.supplierName} className="border-t">
                    <td className="py-1.5">{s.supplierName}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.billCount}</td>
                    <td className="py-1.5 text-right tabular-nums">{GHS_COMPACT(s.spend)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{s.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </>
  )
}

// ─── Expenses ───────────────────────────────────────────────────────────────

const CATEGORY_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#06b6d4',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
]

function ExpensesTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(STORE_EXPENSES_KEY(periodQuery), () => getStoreExpenses(periodQuery))
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (loading || !data) return <PageLoader />
  if (error)
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    )

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total expense" value={GHS_COMPACT(data.tiles.totalExpense)} icon={Banknote} />
        <Tile
          label="Total revenue"
          value={GHS_COMPACT(data.tiles.totalRevenue)}
          icon={TrendingDown}
        />
        <Tile
          label="Expense-to-revenue"
          value={`${data.tiles.expenseToRevenuePct}%`}
          icon={Coins}
          tone={
            data.tiles.expenseToRevenuePct > 70
              ? 'danger'
              : data.tiles.expenseToRevenuePct > 50
                ? 'warning'
                : 'success'
          }
        />
        <Tile
          label="Top category"
          value={data.tiles.topCategory ?? '—'}
          icon={Boxes}
          subText={GHS_COMPACT(data.tiles.topCategoryAmount)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Expense vs revenue by month">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.monthly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
              <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} />
              <Line type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Top expense categories">
          {data.byCategory.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No expenses in the selected window.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.byCategory.slice(0, 10)}
                layout="vertical"
                margin={{ top: 4, right: 8, left: 80, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={GHS_COMPACT} />
                <YAxis type="category" dataKey="category" width={80} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value, name) => [GHS(value as number), name]} />
                <Bar dataKey="amount">
                  {data.byCategory.slice(0, 10).map((_, idx) => (
                    <Cell key={idx} fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </>
  )
}

// ─── Inventory aging ────────────────────────────────────────────────────────

function InventoryAgingTab() {
  const { period } = useAnalyticsPeriod()
  const periodQuery = useMemo(() => buildPeriodQuery(period), [period])
  const query = useApiQuery(STORE_INVENTORY_AGING_KEY(periodQuery), () =>
    getStoreInventoryAging(periodQuery)
  )
  const data = query.data ?? null
  const loading = query.isLoading
  const error = query.error ? query.error.message : null

  if (loading || !data) return <PageLoader />
  if (error)
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </p>
    )

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="SKUs with stock" value={String(data.tiles.totalSkusWithStock)} icon={Boxes} />
        <Tile
          label="Aged 90+ days"
          value={String(data.tiles.aged90)}
          icon={Clock}
          tone={data.tiles.aged90 > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Aged 180+ days"
          value={String(data.tiles.aged180)}
          icon={Package}
          tone={data.tiles.aged180 > 0 ? 'warning' : 'default'}
        />
        <Tile
          label="Aged 365+ days"
          value={String(data.tiles.aged365)}
          icon={PackageX}
          tone={data.tiles.aged365 > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Inventory age distribution">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.ageBuckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="items" name="SKU count" fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="units" name="Stock units" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Items on shelf > 365 days (top 25)">
          {data.agedItems.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No aged items detected.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium pb-1">Item</th>
                  <th className="text-right font-medium pb-1">Stock</th>
                  <th className="text-right font-medium pb-1">Days held</th>
                </tr>
              </thead>
              <tbody>
                {data.agedItems.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="py-1.5">{item.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{item.stockQuantity}</td>
                    <td className="py-1.5 text-right tabular-nums">{item.daysOnHand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </>
  )
}
