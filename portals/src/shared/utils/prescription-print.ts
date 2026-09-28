interface PrescriptionDrug {
  medication: string
  dosage?: string
  frequency?: string
  duration?: string
  notes?: string
}

interface PrescriptionReceiptData {
  patientName: string
  prescribedBy?: string | null
  drugs: PrescriptionDrug[]
  notes?: string | null
  clinicName: string
  clinicPhone?: string | null
  clinicAddress?: string | null
  generatedAt: string
}

export function generatePrescriptionReceipt(
  receiptData: PrescriptionReceiptData,
  autoPrint: boolean = true
) {
  // Create a new window for the receipt
  const receiptWindow = window.open('', '_blank', 'width=400,height=800')
  if (receiptWindow) {
    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Prescription - ${receiptData.patientName}</title>
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
          .drug-list {
            border-top: 1px dashed #000; 
            border-bottom: 1px dashed #000; 
            padding: 15px 0; 
            margin: 20px 0; 
          }
          .drug-item {
            margin-bottom: 15px;
          }
          .drug-name {
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 2px;
          }
          .drug-details {
            font-size: 12px;
            color: #333;
          }
          .footer { 
            margin-top: 30px; 
            font-size: 12px;
            text-align: center;
          }
          .footer p {
            margin: 5px 0;
          }
          @media print { 
            body { padding: 0.5cm; }
            .no-print { display: none; }
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
            ${receiptData.clinicPhone ? `<div class="clinic-phone">${receiptData.clinicPhone}</div>` : ''}
            ${receiptData.clinicAddress ? `<div class="clinic-address">${receiptData.clinicAddress}</div>` : ''}
            <div class="meta-info">${receiptData.generatedAt}</div>
            <div class="receipt-title">Prescription Details</div>
          </div>

          <div class="content">
            <div class="row">
              <span class="label">Patient:</span>
              <span class="value">${receiptData.patientName}</span>
            </div>
            ${
              receiptData.prescribedBy
                ? `
            <div class="row">
              <span class="label">Prescriber:</span>
              <span class="value">${receiptData.prescribedBy}</span>
            </div>`
                : ''
            }
          </div>

          <div className="drug-list">
            ${receiptData.drugs
              .map(
                (drug) => `
              <div class="drug-item">
                <div class="drug-name">${drug.medication}</div>
                <div class="drug-details">
                  ${drug.dosage ? `<span>Dosage: ${drug.dosage}</span><br/>` : ''}
                  ${drug.frequency ? `<span>Frequency: ${drug.frequency}</span><br/>` : ''}
                  ${drug.duration ? `<span>Duration: ${drug.duration} ${Number.isFinite(Number(drug.duration)) ? 'days' : ''}</span><br/>` : ''}
                  ${drug.notes ? `<span style="font-style: italic">Notes: ${drug.notes}</span>` : ''}
                </div>
              </div>
            `
              )
              .join('')}
            ${receiptData.drugs.length === 0 ? '<div class="drug-item">No prescriptions listed.</div>' : ''}
          </div>

          ${
            receiptData.notes
              ? `
          <div class="content">
            <div class="row" style="flex-direction: column;">
              <span class="label">Notes:</span>
              <span class="value" style="text-align: left; font-size: 12px; margin-top: 5px;">${receiptData.notes}</span>
            </div>
          </div>`
              : ''
          }

          <div class="footer">
            <div style="margin-top: 15px; font-size: 10px;">
              Powered by ${import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic'}
            </div>
          </div>
        </div>

        ${
          autoPrint
            ? `
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 1000);
          }
        </script>`
            : ''
        }
      </body>
      </html>
    `)
    receiptWindow.document.close()
  }
}
