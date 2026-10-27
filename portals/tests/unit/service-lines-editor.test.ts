/**
 * G02 — the shared service-line editor's pricing preview.
 * See project-docs/DENEL_FRAMADA_AUDIT_2026-10-25.md (G02) and step-10-handover.md.
 *
 * `previewServiceLine` is the portal's live preview of what a line costs. The server (`computeLine`
 * in backend/src/lib/invoice-service.ts and `resolveServicePrice` in service-pricing.ts) stays the
 * source of truth and prices every stored estimate and invoice; the preview must agree with it.
 * Every money value below is an integer count of pesewas ("cents"), the unit the API uses. A
 * surcharge or discount of the "amount" kind is typed in cedis and converted, as on screen.
 */
import { describe, expect, it } from 'vitest'
import type { ApplicationScope, ServiceMatrix, ServicePriceCell } from '@/lib/actions/services'
import {
  computeServiceLinesTotal,
  previewServiceLine,
  type ServiceLine,
  serviceLinesNeedSurchargeConfirm,
} from '@/shared/components/service-lines-editor'

function makeScope(overrides: Partial<ApplicationScope> = {}): ApplicationScope {
  return {
    id: 'scope-1',
    name: 'unit',
    displayName: 'Unit',
    quantityMode: 'multi',
    maxQuantity: 10,
    additionalUnitPriceEnabled: false,
    variantType: 'none',
    sortOrder: 0,
    isActive: true,
    ...overrides,
  }
}

function makeCell(overrides: Partial<ServicePriceCell> = {}): ServicePriceCell {
  return {
    id: 'cell-1',
    serviceId: 'svc-1',
    serviceCode: null,
    variantName: null,
    toothClassId: null,
    price: 100000,
    priceMin: null,
    priceMax: null,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  }
}

function makeMatrix(opts: {
  scope?: ApplicationScope | null
  cells?: ServicePriceCell[]
  /** The service's price for each unit after the first (G01); the type's switch is on the scope. */
  additionalUnitPrice?: number | null
}): ServiceMatrix {
  const scope = opts.scope === undefined ? makeScope() : opts.scope
  const cells = opts.cells ?? []
  return {
    service: {
      id: 'svc-1',
      name: 'Acrylic Denture',
      amount: 100000,
      serviceCode: null,
      scopeId: scope?.id ?? null,
      priceMin: null,
      priceMax: null,
      additionalUnitPrice: opts.additionalUnitPrice ?? null,
      variantsEnabled: cells.length > 0,
      priceRangeEnabled: false,
      taxIds: [],
    },
    scope,
    cells,
    variants: [...new Set(cells.map((c) => c.variantName).filter((v): v is string => !!v))],
    toothClasses: [],
  }
}

function makeLine(overrides: Partial<ServiceLine> = {}): ServiceLine {
  return {
    key: 'line-1',
    serviceId: 'svc-1',
    name: 'Acrylic Denture',
    baseAmount: 100000,
    matrix: null,
    variantName: '',
    toothClassId: '',
    quantity: 1,
    discountEligible: false,
    surchargeType: 'none',
    surchargeValue: 0,
    discountType: 'none',
    discountValue: 0,
    discountReason: '',
    ...overrides,
  }
}

describe('previewServiceLine — the unit price', () => {
  it('prices a line whose matrix has not arrived yet at its catalogue amount times its quantity', () => {
    const p = previewServiceLine(makeLine({ baseAmount: 15000, quantity: 3, matrix: null }))
    expect(p.unitPrice).toBe(15000)
    expect(p.quantity).toBe(3)
    expect(p.total).toBe(45000)
  })

  it('prices a service that has a matrix but no price cells at its catalogue amount', () => {
    const p = previewServiceLine(
      makeLine({
        baseAmount: 15000,
        matrix: makeMatrix({ scope: makeScope({ quantityMode: 'single' }) }),
      })
    )
    expect(p.unitPrice).toBe(15000)
    expect(p.total).toBe(15000)
  })

  describe('with price cells', () => {
    const cells = [
      makeCell({ id: 'a', variantName: 'Standard', toothClassId: 'molar', price: 90000 }),
      makeCell({ id: 'b', variantName: 'Standard', toothClassId: null, price: 80000 }),
      makeCell({ id: 'c', variantName: null, toothClassId: 'molar', price: 70000 }),
      makeCell({ id: 'd', variantName: null, toothClassId: null, price: 60000 }),
    ]
    const matrix = makeMatrix({ cells })

    it.each([
      ['the exact variant and tooth class', 'Standard', 'molar', 90000],
      [
        'the variant alone when the tooth class has no cell of its own',
        'Standard',
        'incisor',
        80000,
      ],
      ['the tooth class alone when the variant has no cell of its own', 'Rare', 'molar', 70000],
      ['the flat cell when neither has one', 'Rare', 'incisor', 60000],
      ['the flat cell when nothing is chosen', '', '', 60000],
    ])('uses %s', (_what, variantName, toothClassId, expected) => {
      const p = previewServiceLine(makeLine({ matrix, variantName, toothClassId }))
      expect(p.unitPrice).toBe(expected)
    })

    it('falls back to the catalogue amount when no cell fits the choice', () => {
      // Only a "Standard" cell exists, so a line with no variant picked matches nothing.
      const standardOnly = makeMatrix({
        cells: [makeCell({ variantName: 'Standard', price: 80000 })],
      })
      const p = previewServiceLine(makeLine({ matrix: standardOnly, variantName: '' }))
      expect(p.unitPrice).toBe(100000)
    })

    it('ignores a cell that has been switched off', () => {
      const off = makeMatrix({ cells: [makeCell({ price: 99999, isActive: false })] })
      const p = previewServiceLine(makeLine({ matrix: off }))
      expect(p.unitPrice).toBe(100000)
    })
  })
})

describe('previewServiceLine — the quantity', () => {
  it('bills a single-quantity service once, whatever quantity the line holds', () => {
    const matrix = makeMatrix({ scope: makeScope({ quantityMode: 'single' }) })
    const p = previewServiceLine(makeLine({ matrix, quantity: 5 }))
    expect(p.quantity).toBe(1)
    expect(p.total).toBe(100000)
  })

  it('bills a service with no application type once, as the server does', () => {
    const matrix = makeMatrix({ scope: null })
    const p = previewServiceLine(makeLine({ matrix, quantity: 5 }))
    expect(p.quantity).toBe(1)
    expect(p.total).toBe(100000)
  })

  it.each([
    ['with price cells', [makeCell({ price: 80000 })], 80000],
    ['without price cells', [], 100000],
  ])("caps a multi-quantity service at its type's maximum, %s", (_what, cells, unit) => {
    // The server clamps by the application type whether or not the service has price cells.
    const matrix = makeMatrix({ scope: makeScope({ maxQuantity: 4 }), cells })
    const p = previewServiceLine(makeLine({ matrix, quantity: 9 }))
    expect(p.quantity).toBe(4)
    expect(p.total).toBe(unit * 4)
  })

  it('does not cap a multi-quantity service whose type has no maximum', () => {
    const matrix = makeMatrix({ scope: makeScope({ maxQuantity: null }) })
    expect(previewServiceLine(makeLine({ matrix, quantity: 25 })).quantity).toBe(25)
  })

  it('bills whole units only: a typed 2.5 is two, as the server floors it', () => {
    // The payment sheet records this total as money, so a fraction of a unit must not reach it.
    const p = previewServiceLine(makeLine({ matrix: makeMatrix({}), quantity: 2.5 }))
    expect(p.quantity).toBe(2)
    expect(p.total).toBe(200000)
  })

  it('never bills less than one unit', () => {
    const matrix = makeMatrix({})
    expect(previewServiceLine(makeLine({ matrix, quantity: 0 })).quantity).toBe(1)
    expect(previewServiceLine(makeLine({ matrix, quantity: -3 })).quantity).toBe(1)
  })
})

// G01 — the first-unit / additional-unit tariff. The server prices it (`computeLine`); the preview
// has to show the same figure. A service is stepped when its type's switch is on AND the service has
// the further-unit price; the first unit costs the unit price (the chosen variant's, or the catalogue
// amount), each further unit the additional price.
describe('previewServiceLine — first-unit / additional-unit tariff', () => {
  const stepped = (
    over: { switchOn?: boolean; additional?: number | null; max?: number | null } = {}
  ) =>
    makeMatrix({
      scope: makeScope({
        additionalUnitPriceEnabled: over.switchOn ?? true,
        maxQuantity: over.max === undefined ? 10 : over.max,
      }),
      additionalUnitPrice: over.additional === undefined ? 6000 : over.additional,
    })

  it('bills the first unit at the unit price and each further unit at the additional price', () => {
    const p = previewServiceLine(makeLine({ baseAmount: 10000, quantity: 3, matrix: stepped() }))

    expect(p.unitPrice).toBe(10000)
    expect(p.quantity).toBe(3)
    expect(p.additionalUnitPrice).toBe(6000)
    expect(p.subtotal).toBe(22000) // 10000 + 2 × 6000
    expect(p.total).toBe(22000)
  })

  it('bills one unit at the unit price alone', () => {
    const p = previewServiceLine(makeLine({ baseAmount: 10000, quantity: 1, matrix: stepped() }))

    expect(p.subtotal).toBe(10000)
    expect(p.additionalUnitPrice).toBeNull()
  })

  it('is flat when the type’s switch is off, whatever the service carries', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, quantity: 3, matrix: stepped({ switchOn: false }) })
    )

    expect(p.subtotal).toBe(30000)
    expect(p.additionalUnitPrice).toBeNull()
  })

  it('is flat when the service has no additional price', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, quantity: 3, matrix: stepped({ additional: null }) })
    )

    expect(p.subtotal).toBe(30000)
    expect(p.additionalUnitPrice).toBeNull()
  })

  it('lets the further units be free (0 is a price, not “none”)', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, quantity: 4, matrix: stepped({ additional: 0 }) })
    )

    expect(p.subtotal).toBe(10000)
    expect(p.additionalUnitPrice).toBe(0)
  })

  it('stops at the type’s maximum quantity', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, quantity: 9, matrix: stepped({ max: 4 }) })
    )

    expect(p.quantity).toBe(4)
    expect(p.subtotal).toBe(28000) // 10000 + 3 × 6000
  })

  it('ignores the step for a type billed once', () => {
    const matrix = makeMatrix({
      scope: makeScope({ quantityMode: 'single', additionalUnitPriceEnabled: true }),
      additionalUnitPrice: 6000,
    })

    const p = previewServiceLine(makeLine({ baseAmount: 10000, quantity: 3, matrix }))

    expect(p.quantity).toBe(1)
    expect(p.subtotal).toBe(10000)
  })

  describe('with a variant', () => {
    const matrix = makeMatrix({
      scope: makeScope({ additionalUnitPriceEnabled: true }),
      additionalUnitPrice: 6000,
      cells: [
        makeCell({ id: 'a', variantName: 'Simple', price: 10000 }),
        makeCell({ id: 'b', variantName: 'Surgical', price: 20000 }),
      ],
    })

    it('pairs the chosen variant’s first-unit price with the same additional price', () => {
      const simple = previewServiceLine(
        makeLine({ baseAmount: 5000, quantity: 3, variantName: 'Simple', matrix })
      )
      const surgical = previewServiceLine(
        makeLine({ baseAmount: 5000, quantity: 3, variantName: 'Surgical', matrix })
      )

      expect(simple.subtotal).toBe(22000) // 10000 + 2 × 6000
      expect(surgical.subtotal).toBe(32000) // 20000 + 2 × 6000
    })

    it('uses the catalogue amount as the first unit when no variant is chosen (Default)', () => {
      const p = previewServiceLine(makeLine({ baseAmount: 5000, quantity: 3, matrix }))

      expect(p.unitPrice).toBe(5000)
      expect(p.subtotal).toBe(17000) // 5000 + 2 × 6000
    })
  })

  it('applies a surcharge and a discount to the stepped subtotal', () => {
    const p = previewServiceLine(
      makeLine({
        baseAmount: 10000,
        quantity: 3,
        matrix: stepped(),
        surchargeType: 'percent',
        surchargeValue: 10,
        discountType: 'percent',
        discountValue: 10,
      })
    )

    expect(p.subtotal).toBe(22000)
    expect(p.surchargeAmount).toBe(2200) // 10% of 22000
    expect(p.discountAmount).toBe(2420) // 10% of (22000 + 2200)
    expect(p.total).toBe(21780)
  })

  it('counts a stepped line by its stepped total when lines are added up', () => {
    const lines = [
      makeLine({ key: 'a', baseAmount: 10000, quantity: 3, matrix: stepped() }),
      makeLine({ key: 'b', baseAmount: 15000, quantity: 1, matrix: null }),
    ]

    expect(computeServiceLinesTotal(lines)).toBe(22000 + 15000)
  })
})

describe('previewServiceLine — surcharge and discount', () => {
  it('adds a percentage surcharge to the subtotal, rounded to a whole pesewa', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10009, surchargeType: 'percent', surchargeValue: 10 })
    )
    // 10% of 10,009 is 1,000.9 pesewas.
    expect(p.surchargeAmount).toBe(1001)
    expect(p.total).toBe(11010)
  })

  // Review §8.16 (F85): the server rounds a percentage half to even (`Money.percent`), so at an
  // exact half pesewa the preview must too, or the screen shows one pesewa more than is stored.
  it('rounds a half pesewa to even, as the server does', () => {
    // 25% of 10 pesewas is 2.5; 25% of 30 is 7.5; 25% of 14 is 3.5.
    const surcharge = (baseAmount: number) =>
      previewServiceLine(makeLine({ baseAmount, surchargeType: 'percent', surchargeValue: 25 }))
        .surchargeAmount
    expect(surcharge(10)).toBe(2) // 2.5 -> 2 (Math.round says 3)
    expect(surcharge(30)).toBe(8) // 7.5 -> 8
    expect(surcharge(14)).toBe(4) // 3.5 -> 4
  })

  it('rounds a percentage discount of a half pesewa to even too', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10, discountType: 'percent', discountValue: 25 })
    )
    expect(p.discountAmount).toBe(2)
    expect(p.total).toBe(8)
  })

  it('takes a surcharge amount in cedis and converts it to pesewas', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, surchargeType: 'amount', surchargeValue: 12.5 })
    )
    expect(p.surchargeAmount).toBe(1250)
    expect(p.total).toBe(11250)
  })

  it('takes a discount after the surcharge, not before it', () => {
    const p = previewServiceLine(
      makeLine({
        baseAmount: 10000,
        surchargeType: 'percent',
        surchargeValue: 20,
        discountType: 'percent',
        discountValue: 10,
      })
    )
    // 100.00 + 20% surcharge = 120.00 gross; 10% of the gross (not of 100.00) is 12.00.
    expect(p.surchargeAmount).toBe(2000)
    expect(p.discountAmount).toBe(1200)
    expect(p.total).toBe(10800)
  })

  it('takes a discount amount in cedis and converts it to pesewas', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, discountType: 'amount', discountValue: 15 })
    )
    expect(p.discountAmount).toBe(1500)
    expect(p.total).toBe(8500)
  })

  it('never discounts a line below nothing: an amount larger than the line is capped at the line', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, discountType: 'amount', discountValue: 500 })
    )
    expect(p.discountAmount).toBe(10000)
    expect(p.total).toBe(0)
  })

  it('caps a percentage discount above 100% at the line, as the server does', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 10000, discountType: 'percent', discountValue: 150 })
    )
    expect(p.discountAmount).toBe(10000)
    expect(p.total).toBe(0)
  })

  it('ignores a value left behind on a surcharge or discount whose type is none', () => {
    const p = previewServiceLine(
      makeLine({
        baseAmount: 10000,
        surchargeType: 'none',
        surchargeValue: 50,
        discountType: 'none',
        discountValue: 50,
      })
    )
    expect(p.surchargeAmount).toBe(0)
    expect(p.discountAmount).toBe(0)
    expect(p.total).toBe(10000)
  })
})

describe('previewServiceLine — a surcharge that more than doubles the line', () => {
  it.each([
    ['100% of the line', 'percent', 100, false],
    ['101% of the line', 'percent', 101, true],
    ['an amount equal to the line', 'amount', 100, false],
    ['an amount a pesewa over the line', 'amount', 100.01, true],
  ] as const)('%s: needsConfirm is %s', (_what, surchargeType, surchargeValue, expected) => {
    // A 100.00 line, so 100% and 100.00 are the same surcharge.
    const p = previewServiceLine(makeLine({ baseAmount: 10000, surchargeType, surchargeValue }))
    expect(p.needsConfirm).toBe(expected)
  })

  it('never asks about a line that costs nothing', () => {
    const p = previewServiceLine(
      makeLine({ baseAmount: 0, surchargeType: 'amount', surchargeValue: 5 })
    )
    expect(p.needsConfirm).toBe(false)
  })
})

describe('computeServiceLinesTotal', () => {
  it('adds up what every line previews to, surcharges and discounts included', () => {
    const lines = [
      makeLine({ key: 'a', baseAmount: 10000, surchargeType: 'percent', surchargeValue: 10 }),
      makeLine({
        key: 'b',
        baseAmount: 20000,
        quantity: 2,
        discountType: 'amount',
        discountValue: 50,
      }),
    ]
    // 110.00 + (400.00 - 50.00)
    expect(computeServiceLinesTotal(lines)).toBe(11000 + 35000)
  })

  it('is nothing for no lines', () => {
    expect(computeServiceLinesTotal([])).toBe(0)
  })
})

describe('serviceLinesNeedSurchargeConfirm', () => {
  const fine = makeLine({ key: 'a', baseAmount: 10000 })
  const mistyped = makeLine({
    key: 'b',
    baseAmount: 10000,
    surchargeType: 'percent',
    surchargeValue: 500,
  })

  it('is true as soon as any one line needs it', () => {
    expect(serviceLinesNeedSurchargeConfirm([fine, mistyped])).toBe(true)
  })

  it('is false when no line does, and for no lines', () => {
    expect(serviceLinesNeedSurchargeConfirm([fine])).toBe(false)
    expect(serviceLinesNeedSurchargeConfirm([])).toBe(false)
  })
})
