/**
 * `<Amount>` — the sanctioned way to put money on screen.
 *
 * The values below are the real ones from invoice INV-2026-00002, the slip that
 * triggered this whole audit: it printed "GHS 1800000.00" for a GHS 18,000.00
 * line because the component hand-rolled `Number(x).toFixed(2)` instead of
 * converting. These assertions are the contract that regression has to break.
 *
 * See project-docs/money-unit-audit-and-remediation.md.
 */

import { Amount } from '@denel/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('<Amount>', () => {
  it('renders minor units (pesewas) as cedis', () => {
    const { container } = render(<Amount value={1800000} />)
    expect(container.textContent).toBe('GH₵18,000.00')
  })

  it('renders the invoice that started this — every figure, in cedis', () => {
    render(
      <dl>
        <dd data-testid="total">
          <Amount value={1600000} format="plain" />
        </dd>
        <dd data-testid="paid">
          <Amount value={700000} format="plain" />
        </dd>
        <dd data-testid="balance">
          <Amount value={900000} format="plain" />
        </dd>
      </dl>
    )
    expect(screen.getByTestId('total').textContent).toBe('16,000.00')
    expect(screen.getByTestId('paid').textContent).toBe('7,000.00')
    expect(screen.getByTestId('balance').textContent).toBe('9,000.00')
  })

  it('renders one pesewa as GH₵0.01 — the minor unit is 1/100 of a cedi', () => {
    const { container } = render(<Amount value={1} />)
    expect(container.textContent).toBe('GH₵0.01')
  })

  it('treats nullish as zero rather than rendering NaN', () => {
    expect(render(<Amount value={null} />).container.textContent).toBe('GH₵0.00')
    expect(render(<Amount value={undefined} />).container.textContent).toBe('GH₵0.00')
    expect(render(<Amount value="" />).container.textContent).toBe('GH₵0.00')
  })

  it('accepts the string form the API sometimes returns', () => {
    expect(render(<Amount value="1800000" />).container.textContent).toBe('GH₵18,000.00')
  })

  it('renders negative amounts (a refund or credit) with the sign', () => {
    expect(render(<Amount value={-700000} />).container.textContent).toBe('-GH₵7,000.00')
  })

  it('passes className and DOM props through', () => {
    const { container } = render(<Amount value={100} className="font-bold" title="Line total" />)
    const span = container.querySelector('span')
    expect(span?.className).toContain('font-bold')
    expect(span?.className).toContain('tabular-nums')
    expect(span?.getAttribute('title')).toBe('Line total')
  })
})
