import { Calculator } from 'lucide-react'

export default function TaxCalculationsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">Tax Calculations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          GRA tax records for invoiced transactions
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed min-h-[400px]">
        <div className="flex flex-col items-center gap-2 text-center">
          <Calculator className="h-10 w-10 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Tax Calculations</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            GRA tax breakdown per invoice will appear here. This report is coming soon.
          </p>
        </div>
      </div>
    </div>
  )
}
