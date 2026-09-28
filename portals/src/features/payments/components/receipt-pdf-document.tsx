import { Document, Image, Page, View } from '@react-pdf/renderer'
import { Divider } from '@/components/pdf/divider/divider'
import { Text } from '@/components/pdf/text/text'
import { formatAmount } from '@/shared/utils/currency'
import type { ReceiptDataShape } from './receipt-view-dialog'

function ghs(n: number) {
  return `GHS ${formatAmount(n)}`
}

function methodLabel(m: string) {
  if (!m) return ''
  return m
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bMomo\b/, 'Mobile Money')
}

function deriveService(receiptData: ReceiptDataShape): string {
  const fromAllocs =
    receiptData.allocations?.flatMap((a) => a.treatments ?? []).filter((s) => s.trim()) ?? []
  if (fromAllocs.length > 0) return [...new Set(fromAllocs)].join(', ')
  return receiptData.paymentFor || 'Service Payment'
}

function deriveReference(receiptData: ReceiptDataShape): string | null {
  const invs = receiptData.invoiceNumbers ?? receiptData.allocations?.map((a) => a.invoiceNumber)
  if (invs && invs.length > 0) return invs.join(', ')
  if (receiptData.paymentNumbers && receiptData.paymentNumbers.length > 0)
    return receiptData.paymentNumbers.join(', ')
  return receiptData.paymentNumber ?? null
}

function deriveBalance(receiptData: ReceiptDataShape): number | null {
  if (receiptData.balance != null) return receiptData.balance
  if (receiptData.allocations && receiptData.allocations.length > 0) {
    const balances = receiptData.allocations
      .map((a) => a.remainingBalance)
      .filter((b): b is number => b != null)
    if (balances.length === 0) return null
    return balances.reduce((s, b) => s + b, 0)
  }
  return null
}

export function ReceiptPdfDocument({ receiptData }: { receiptData: ReceiptDataShape }) {
  const service = deriveService(receiptData)
  const reference = deriveReference(receiptData)
  const balance = deriveBalance(receiptData)
  const methods =
    receiptData.methods && receiptData.methods.length > 0
      ? receiptData.methods
      : [
          {
            method: receiptData.paymentType,
            amount: receiptData.amountPaid,
            reference: null,
            paymentNumber: receiptData.paymentNumber ?? null,
          },
        ]

  return (
    <Document>
      <Page size="A5" style={{ padding: 32, backgroundColor: '#ffffff' }}>
        <View style={{ alignItems: 'center', marginBottom: 14 }}>
          <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>
            {receiptData.clinicName}
          </Text>
          {receiptData.clinicAddress && (
            <Text style={{ fontSize: 10 }}>{receiptData.clinicAddress}</Text>
          )}
          {receiptData.clinicPhone && (
            <Text style={{ fontSize: 10 }}>{receiptData.clinicPhone}</Text>
          )}
        </View>

        <View
          style={{
            alignItems: 'center',
            marginBottom: 16,
            borderBottomWidth: 1,
            borderBottomStyle: 'dashed',
            borderBottomColor: '#000',
            paddingBottom: 12,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase' }}>
            Payment Receipt
          </Text>
          <Text style={{ fontSize: 10, marginTop: 4 }}>
            {new Date(receiptData.generatedAt).toLocaleString()}
          </Text>
        </View>

        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 11, color: '#666' }}>Patient:</Text>
            <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{receiptData.patientName}</Text>
          </View>
          {reference && (
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}
            >
              <Text style={{ fontSize: 11, color: '#666' }}>Reference:</Text>
              <Text style={{ fontSize: 11 }}>{reference}</Text>
            </View>
          )}
        </View>

        <Divider variant="dashed" spacing="md" />

        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>Applied To:</Text>

          {receiptData.allocations && receiptData.allocations.length > 0 ? (
            receiptData.allocations.map((alloc, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{alloc.invoiceNumber}</Text>
                  <Text style={{ fontSize: 11 }}>{ghs(alloc.amountApplied)}</Text>
                </View>
                {alloc.treatments && alloc.treatments.length > 0 && (
                  <Text style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                    {alloc.treatments.join(', ')}
                  </Text>
                )}
              </View>
            ))
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 11 }}>{service}</Text>
              <Text style={{ fontSize: 11 }}>{ghs(receiptData.amountPaid)}</Text>
            </View>
          )}
        </View>

        <Divider variant="dashed" spacing="md" />

        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>Payment By:</Text>
          {methods.map((m, i) => (
            <View
              key={i}
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}
            >
              <Text style={{ fontSize: 11 }}>
                {methodLabel(m.method)} {m.paymentNumber ? `(${m.paymentNumber})` : ''}
              </Text>
              <Text style={{ fontSize: 11 }}>{ghs(m.amount)}</Text>
            </View>
          ))}

          {receiptData.unallocatedAmount ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontSize: 11 }}>Unapplied / To Wallet</Text>
              <Text style={{ fontSize: 11 }}>{ghs(receiptData.unallocatedAmount)}</Text>
            </View>
          ) : null}
        </View>

        <View
          style={{
            borderTopWidth: 1,
            borderTopStyle: 'solid',
            borderTopColor: '#000',
            paddingTop: 8,
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: 'bold' }}>Total Paid</Text>
          <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{ghs(receiptData.amountPaid)}</Text>
        </View>

        {balance != null && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 11, color: '#666' }}>Remaining Balance</Text>
            <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{ghs(balance)}</Text>
          </View>
        )}

        <View style={{ marginTop: 32, alignItems: 'center' }}>
          <Text style={{ fontSize: 10, color: '#666' }}>Thank you for your business!</Text>
        </View>
      </Page>
    </Document>
  )
}
