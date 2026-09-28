import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ReceiptViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  receiptData: {
    patientName: string
    appointmentDate?: string
    amountPaid: number
    totalAmount?: number
    balance?: number
    paymentType: string
    paymentFor: string
    notes?: string | null
    clinicName: string
    clinicPhone?: string | null
    clinicAddress?: string | null
    clinicWebsite?: string | null
    generatedAt: string
  }
}

function truncateService(service: string, maxLength: number = 22): string {
  if (!service) return ''
  if (service.length <= maxLength) return service
  return `${service.slice(0, maxLength).trimEnd()}...`
}

function formatReceiptDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ReceiptViewDialog({ open, onOpenChange, receiptData }: ReceiptViewDialogProps) {
  const handlePrint = () => {
    // Create a print-friendly version
    const printWindow = window.open('', '_blank', 'width=400,height=800')
    if (printWindow) {
      printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Receipt - ${receiptData.patientName}</title>
                    <style>
                        body { 
                            font-family: 'Courier New', Courier, monospace; 
                            margin: 0; 
                            padding: 20px; 
                            color: #000; 
                            font-size: 14px;
                            line-height: 1.4;
                        }
                        .container {
                            max-width: 350px;
                            margin: 0 auto;
                            background: #fff;
                        }
                        .header { 
                            text-align: center; 
                            margin-bottom: 20px; 
                            padding-bottom: 10px; 
                        }
                        .logo img { 
                            max-width: 120px; 
                            height: auto;
                            margin-bottom: 10px;
                            display: block;
                            margin-left: auto;
                            margin-right: auto;
                        }
                        .clinic-name {
                            font-weight: bold;
                            font-size: 16px;
                            margin-bottom: 5px;
                        }
                        .receipt-title { 
                            font-size: 16px; 
                            font-weight: bold; 
                            margin-top: 10px; 
                            text-transform: uppercase; 
                            border-top: 1px dashed #000;
                            border-bottom: 1px dashed #000; 
                            padding: 10px 0;
                            display: block;
                        }
                        .meta-info {
                            font-size: 10px;
                            margin-top: 5px;
                        }
                        .content { 
                            margin-bottom: 20px; 
                            margin-top: 20px;
                        }
                        .row { 
                            display: flex; 
                            justify-content: space-between; 
                            margin-bottom: 8px; 
                        }
                        .label { 
                            font-weight: bold; 
                        }
                        .value { 
                            text-align: right;
                        }
                        .amount-section { 
                            border-top: 1px dashed #000; 
                            border-bottom: 1px dashed #000; 
                            padding: 15px 0; 
                            margin: 20px 0; 
                        }
                        .total-row {
                            display: flex;
                            justify-content: space-between;
                            font-size: 18px;
                            font-weight: bold;
                            margin-bottom: 5px;
                        }
                        .balance-row {
                            display: flex;
                            justify-content: space-between;
                            font-size: 14px;
                        }
                        .footer { 
                            margin-top: 30px; 
                            font-size: 12px;
                            display: flex;
                            justify-content: space-between;
                            align-items: flex-end;
                        }
                        .footer-left {
                            text-align: left;
                        }
                        .footer p {
                            margin: 5px 0;
                        }
                        .qr-code {
                            margin-top: 10px;
                        }
                        .qr-code img {
                            display: block;
                            width: 100px;
                            height: 100px;
                            border: 1px solid #ddd;
                            padding: 5px;
                            background: #fff;
                        }
                        .stamp-space {
                            width: 120px;
                            height: 80px;
                        }
                        @media print { 
                            body { padding: 0.5cm; }
                            .no-print { display: none; }
                            .qr-code img {
                              display: block !important;
                              visibility: visible !important;
                              opacity: 1 !important;
                            }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <div class="logo">
                                <img src="/logo.png" alt="Logo" onerror="this.style.display='none'"/>
                            </div>
                            <div class="clinic-name">${receiptData.clinicName}</div>
                            ${receiptData.clinicWebsite ? `<div class="clinic-website" style="font-size: 11px; margin-bottom: 2px;">${receiptData.clinicWebsite.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</div>` : ''}
                            ${receiptData.clinicPhone ? `<div class="clinic-phone" style="font-size: 11px; margin-bottom: 2px;">${receiptData.clinicPhone}</div>` : ''}
                            ${receiptData.clinicAddress ? `<div class="clinic-address" style="font-size: 11px; margin-bottom: 2px;">${receiptData.clinicAddress}</div>` : ''}
                            <div class="meta-info" style="font-size: 11px; margin-top: 3px;">Date: ${formatReceiptDate(receiptData.generatedAt)}</div>
                            <div class="receipt-title">Payment Receipt</div>
                        </div>

                        <div class="content">
                            <div class="row">
                                <span class="label">Patient:</span>
                                <span class="value">${receiptData.patientName}</span>
                            </div>
                            ${
                              receiptData.appointmentDate
                                ? `
                            <div class="row">
                                <span class="label">Date:</span>
                                <span class="value">${receiptData.appointmentDate}</span>
                            </div>`
                                : ''
                            }
                            <div class="row">
                                <span class="label">Service:</span>
                                <span class="value" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${receiptData.paymentFor}">${truncateService(receiptData.paymentFor, 22)}</span>
                            </div>
                            ${
                              receiptData.notes
                                ? `
                            <div class="row" style="flex-direction: column;">
                                <span class="label">Notes:</span>
                                <span class="value" style="text-align: left; font-size: 12px;">${receiptData.notes}</span>
                            </div>`
                                : ''
                            }
                        </div>

                        <div class="amount-section">
                            <div class="total-row">
                                <span>PAID:</span>
                                <span>GHS ${Number(receiptData.amountPaid).toFixed(2)}</span>
                            </div>
                            <div class="row" style="margin: 6px 0 8px 0;">
                                <span class="label">Method:</span>
                                <span class="value" style="text-transform: capitalize">${receiptData.paymentType}</span>
                            </div>
                            ${
                              receiptData.balance !== undefined && receiptData.balance !== null
                                ? `
                            <div class="total-row">
                                <span>Balance:</span>
                                <span>GHS ${Number(receiptData.balance).toFixed(2)}</span>
                            </div>`
                                : ''
                            }
                            ${
                              receiptData.totalAmount !== undefined &&
                              receiptData.totalAmount !== null
                                ? `
                            <div class="balance-row">
                                <span>Total Amount:</span>
                                <span>GHS ${Number(receiptData.totalAmount).toFixed(2)}</span>
                            </div>`
                                : ''
                            }
                        </div>

                        <div class="footer">
                            <div class="footer-left">
                                <p>Thank you!</p>
                                <p style="margin: 8px 0 0 0; font-weight: bold; font-size: 11px; color: #000;">
                                    Please Note that Payments Made are Non-refundable.
                                </p>
                                
                                <div class="qr-code">
                                    <img 
                                      src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=https://deneldental.com/scan" 
                                      alt="Scan to Rate Us"
                                      width="100"
                                      height="100"
                                      style="display: block; max-width: 100px; height: auto;"
                                    />
                                    <div style="margin-top: 5px; font-size: 10px;">Scan to Rate Us</div>
                                </div>

                                <div style="margin-top: 10px; font-size: 11px; color: #000; font-weight: bold;">
                                    ${receiptData.clinicWebsite || 'www.deneldental.com'}
                                </div>
                            </div>
                            <div class="stamp-space"></div>
                        </div>
                    </div>

                    <script>
                        window.onload = function() {
                            setTimeout(function() {
                                window.print();
                            }, 1000);
                        }
                    </script>
                </body>
                </html>
            `)
      printWindow.document.close()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment Receipt</DialogTitle>
        </DialogHeader>
        <div
          className="receipt-view-container"
          style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '14px',
            lineHeight: '1.4',
            color: '#000',
            background: '#fff',
            padding: '20px',
          }}
        >
          <div style={{ maxWidth: '350px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '20px', paddingBottom: '10px' }}>
              <div style={{ marginBottom: '10px' }}>
                <img
                  src="/logo.png"
                  alt="Logo"
                  width={120}
                  height={40}
                  style={{ maxWidth: '120px', height: 'auto', display: 'block', margin: '0 auto' }}
                />
              </div>
              <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '5px' }}>
                {receiptData.clinicName}
              </div>
              {receiptData.clinicWebsite && (
                <div style={{ fontSize: '11px', marginBottom: '2px' }}>
                  {receiptData.clinicWebsite.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                </div>
              )}
              {receiptData.clinicPhone && (
                <div style={{ fontSize: '12px', marginBottom: '2px' }}>
                  {receiptData.clinicPhone}
                </div>
              )}
              {receiptData.clinicAddress && (
                <div style={{ fontSize: '12px', marginBottom: '2px' }}>
                  {receiptData.clinicAddress}
                </div>
              )}
              <div style={{ fontSize: '11px', marginTop: '3px' }}>
                Date: {formatReceiptDate(receiptData.generatedAt)}
              </div>
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  marginTop: '10px',
                  textTransform: 'uppercase',
                  borderTop: '1px dashed #000',
                  borderBottom: '1px dashed #000',
                  padding: '10px 0',
                }}
              >
                Payment Receipt
              </div>
            </div>

            {/* Content */}
            <div style={{ marginBottom: '20px', marginTop: '20px' }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}
              >
                <span style={{ fontWeight: 'bold' }}>Patient:</span>
                <span style={{ textAlign: 'right' }}>{receiptData.patientName}</span>
              </div>
              {receiptData.appointmentDate && (
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}
                >
                  <span style={{ fontWeight: 'bold' }}>Date:</span>
                  <span style={{ textAlign: 'right' }}>{receiptData.appointmentDate}</span>
                </div>
              )}
              <div
                style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}
              >
                <span style={{ fontWeight: 'bold' }}>Service:</span>
                <span
                  style={{
                    textAlign: 'right',
                    maxWidth: '180px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={receiptData.paymentFor}
                >
                  {truncateService(receiptData.paymentFor, 22)}
                </span>
              </div>
              {receiptData.notes && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Notes:</div>
                  <div style={{ fontSize: '12px', textAlign: 'left' }}>{receiptData.notes}</div>
                </div>
              )}
            </div>

            {/* Amount Section */}
            <div
              style={{
                borderTop: '1px dashed #000',
                borderBottom: '1px dashed #000',
                padding: '15px 0',
                margin: '20px 0',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  marginBottom: '5px',
                }}
              >
                <span>PAID:</span>
                <span>GHS {Number(receiptData.amountPaid).toFixed(2)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  margin: '6px 0 8px 0',
                  fontSize: '13px',
                }}
              >
                <span style={{ fontWeight: 'bold' }}>Method:</span>
                <span style={{ textAlign: 'right', textTransform: 'capitalize' }}>
                  {receiptData.paymentType}
                </span>
              </div>
              {receiptData.balance !== undefined && receiptData.balance !== null && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    marginBottom: '5px',
                  }}
                >
                  <span>Balance:</span>
                  <span>GHS {Number(receiptData.balance).toFixed(2)}</span>
                </div>
              )}
              {receiptData.totalAmount !== undefined && receiptData.totalAmount !== null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span>Total Amount:</span>
                  <span>GHS {Number(receiptData.totalAmount).toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                marginTop: '30px',
                fontSize: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ textAlign: 'left' }}>
                <p style={{ margin: '5px 0' }}>Thank you!</p>
                <p
                  style={{
                    margin: '8px 0 0 0',
                    fontWeight: 'bold',
                    fontSize: '11px',
                    color: '#000',
                  }}
                >
                  Please Note that Payments Made are Non-refundable.
                </p>

                <div style={{ marginTop: '10px' }}>
                  <img
                    src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=https://deneldental.com/scan"
                    alt="Scan to Rate Us"
                    width={100}
                    height={100}
                    style={{
                      display: 'block',
                      maxWidth: '100px',
                      height: 'auto',
                      border: '1px solid #ddd',
                      padding: '5px',
                      backgroundColor: '#fff',
                    }}
                  />
                  <div style={{ marginTop: '5px', fontSize: '10px' }}>Scan to Rate Us</div>
                </div>

                <div
                  style={{
                    marginTop: '10px',
                    fontSize: '11px',
                    color: '#000',
                    fontWeight: 'bold',
                  }}
                >
                  {receiptData.clinicWebsite || 'www.deneldental.com'}
                </div>
              </div>
              <div style={{ width: '120px', height: '80px' }}></div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
