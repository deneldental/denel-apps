/**
 * settings-domain-audit S5-B (inventory): the valuation method chosen in
 * Settings → Inventory → Store Policies decides what stock is worth and what
 * an issue costs. Pure helpers, no DB. Money is integer pesewas.
 */
import { describe, expect, it } from 'vitest'
import {
  averageItemValue,
  cogsForIssue,
  fifoItemValue,
  itemStockValue,
  weightedAverageCost,
} from '../../src/lib/inventory-valuation'

describe('weightedAverageCost', () => {
  it('blends the old stock cost with the receipt cost by quantity', () => {
    expect(weightedAverageCost(10, 100, 10, 200)).toBe(150)
    expect(weightedAverageCost(30, 100, 10, 200)).toBe(125)
  })

  it('takes the receipt cost when there was no priced stock', () => {
    expect(weightedAverageCost(0, 100, 5, 200)).toBe(200)
    expect(weightedAverageCost(10, null, 5, 200)).toBe(200)
  })

  it('rounds to the pesewa', () => {
    expect(weightedAverageCost(3, 100, 1, 150)).toBe(113) // 450 / 4 = 112.5
  })
})

describe('fifoItemValue', () => {
  it('values remaining batches at their own cost', () => {
    const batches = [
      { qtyRemaining: 4, unitCost: 100 },
      { qtyRemaining: 6, unitCost: 250 },
    ]
    expect(fifoItemValue(batches, 10, 999)).toBe(1900)
  })

  it('values stock no batch covers at the item cost', () => {
    expect(fifoItemValue([{ qtyRemaining: 4, unitCost: 100 }], 10, 50)).toBe(400 + 6 * 50)
    expect(fifoItemValue([], 10, 50)).toBe(500)
  })

  it('uses the item cost for a batch without one, and ignores empty batches', () => {
    const batches = [
      { qtyRemaining: 2, unitCost: null },
      { qtyRemaining: 0, unitCost: 100 },
    ]
    expect(fifoItemValue(batches, 2, 30)).toBe(60)
  })

  it('never goes negative when batches exceed the stock count', () => {
    expect(fifoItemValue([{ qtyRemaining: 12, unitCost: 10 }], 10, 5)).toBe(120)
  })
})

describe('averageItemValue / itemStockValue', () => {
  it('is quantity × item cost', () => {
    expect(averageItemValue(10, 150)).toBe(1500)
    expect(averageItemValue(10, null)).toBe(0)
    expect(averageItemValue(-3, 150)).toBe(0)
  })

  it('dispatches on the method', () => {
    const batches = [{ qtyRemaining: 10, unitCost: 100 }]
    expect(itemStockValue('fifo', batches, 10, 150)).toBe(1000)
    expect(itemStockValue('weighted_average', batches, 10, 150)).toBe(1500)
  })
})

describe('cogsForIssue', () => {
  it('FIFO: consumed batches at their cost, uncovered quantity at item cost', () => {
    const consumed = [
      { take: 3, unitCost: 100 },
      { take: 2, unitCost: 200 },
    ]
    expect(cogsForIssue('fifo', consumed, 0, 999)).toBe(700)
    expect(cogsForIssue('fifo', [{ take: 3, unitCost: 100 }], 2, 50)).toBe(400)
    expect(cogsForIssue('fifo', [{ take: 3, unitCost: null }], 0, 50)).toBe(150)
  })

  it('weighted average: the whole quantity at item cost', () => {
    const consumed = [
      { take: 3, unitCost: 100 },
      { take: 2, unitCost: 200 },
    ]
    expect(cogsForIssue('weighted_average', consumed, 1, 80)).toBe(480)
  })
})
