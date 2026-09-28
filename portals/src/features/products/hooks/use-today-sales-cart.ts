import { useSyncExternalStore } from 'react'

export type CartItem = {
  productId: string
  name: string
  unitPrice: number
  costPrice: number
  quantity: number
}

type CartState = {
  date: string // yyyy-mm-dd — cart is reset when the day flips
  items: CartItem[]
}

const STORAGE_KEY = 'denel.todaySalesCart.v1'

function todayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyState(): CartState {
  return { date: todayKey(), items: [] }
}

function loadFromStorage(): CartState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as CartState
    if (!parsed?.date || !Array.isArray(parsed.items)) return emptyState()
    if (parsed.date !== todayKey()) return emptyState()
    return parsed
  } catch {
    return emptyState()
  }
}

function persist(state: CartState) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // quota / private mode — ignore; cart is best-effort
  }
}

let state: CartState = loadFromStorage()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function setState(next: CartState) {
  state = next
  persist(state)
  emit()
}

export const todaySalesCart = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getSnapshot(): CartState {
    return state
  },

  add(input: { productId: string; name: string; unitPrice: number; costPrice: number }) {
    const day = todayKey()
    const items = state.date === day ? state.items.slice() : []
    const idx = items.findIndex((i) => i.productId === input.productId)
    if (idx >= 0) {
      items[idx] = { ...items[idx], quantity: items[idx].quantity + 1 }
    } else {
      items.push({ ...input, quantity: 1 })
    }
    setState({ date: day, items })
  },

  decrement(productId: string) {
    const day = todayKey()
    if (state.date !== day) {
      setState({ date: day, items: [] })
      return
    }
    const items = state.items
      .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i))
      .filter((i) => i.quantity > 0)
    setState({ date: day, items })
  },

  remove(productId: string) {
    const day = todayKey()
    if (state.date !== day) {
      setState({ date: day, items: [] })
      return
    }
    setState({ date: day, items: state.items.filter((i) => i.productId !== productId) })
  },

  clear() {
    setState({ date: todayKey(), items: [] })
  },

  /** Quantity already in cart for a given product (0 if missing). */
  getQuantity(productId: string): number {
    if (state.date !== todayKey()) return 0
    return state.items.find((i) => i.productId === productId)?.quantity ?? 0
  },
}

export function useTodaySalesCart(): CartState {
  return useSyncExternalStore(todaySalesCart.subscribe, todaySalesCart.getSnapshot)
}
