import { PDFDocument } from 'pdf-lib'

/**
 * Validates that uploaded PDF has exactly 2 pages
 */
export async function validateConsentFormUpload(
  pdfBuffer: ArrayBuffer | Buffer
): Promise<{ valid: boolean; error?: string }> {
  try {
    const pdf = await PDFDocument.load(pdfBuffer)
    const pageCount = pdf.getPageCount()

    if (pageCount !== 2) {
      return {
        valid: false,
        error: `Invalid PDF: Expected 2 pages (signed pages 1 and 5), but found ${pageCount} pages.`,
      }
    }

    return { valid: true }
  } catch (_err) {
    return {
      valid: false,
      error: 'Invalid PDF file or corrupted PDF.',
    }
  }
}

/**
 * Process uploaded consent form (2 pages) and combine with templates
 * Templates are fetched from the provided base URL (e.g., S3 or CDN)
 */
export async function processUploadedConsentForm(
  uploadedPdfBuffer: ArrayBuffer | Buffer,
  templateBaseUrl: string
): Promise<Buffer> {
  const uploadedPdf = await PDFDocument.load(uploadedPdfBuffer)
  const finalPdf = await PDFDocument.create()

  async function fetchTemplate(name: string) {
    const res = await fetch(`${templateBaseUrl}/${name}`)
    if (!res.ok) throw new Error(`Failed to fetch template: ${name}`)
    return res.arrayBuffer()
  }

  // 1. Add cover page
  const coverBytes = await fetchTemplate('cover.pdf')
  const coverPdf = await PDFDocument.load(coverBytes)
  const [coverPage] = await finalPdf.copyPages(coverPdf, [0])
  finalPdf.addPage(coverPage)

  // 2. Add page 1 from uploaded PDF
  const [uploadedPage1] = await finalPdf.copyPages(uploadedPdf, [0])
  finalPdf.addPage(uploadedPage1)

  // 3. Add template pages 2, 3, 4
  for (const pageNum of [2, 3, 4]) {
    const templateBytes = await fetchTemplate(`${pageNum}.pdf`)
    const templatePdf = await PDFDocument.load(templateBytes)
    const [templatePage] = await finalPdf.copyPages(templatePdf, [0])
    finalPdf.addPage(templatePage)
  }

  // 4. Add page 2 from uploaded PDF (becomes page 5)
  const [uploadedPage2] = await finalPdf.copyPages(uploadedPdf, [1])
  finalPdf.addPage(uploadedPage2)

  const finalPdfBytes = await finalPdf.save()
  return Buffer.from(finalPdfBytes)
}
