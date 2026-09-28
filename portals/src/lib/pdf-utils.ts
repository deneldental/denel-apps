import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

/**
 * Get the full template PDF (all 6 pages combined)
 * Order: cover + 1 + 2 + 3 + 4 + 5
 */
export async function generateConsentFormTemplate(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()

  // Define the order of template pages
  const templateFiles = ['cover.pdf', '1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf']

  // Read and merge all template PDFs
  for (const filename of templateFiles) {
    const filePath = join(process.cwd(), 'public', 'PDF', filename)
    const pdfBytes = await readFile(filePath)
    const sourcePdf = await PDFDocument.load(pdfBytes)

    // Copy all pages from source PDF
    const copiedPages = await pdfDoc.copyPages(sourcePdf, sourcePdf.getPageIndices())
    copiedPages.forEach((page) => {
      pdfDoc.addPage(page)
    })
  }

  // Save the combined PDF
  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

/**
 * Process uploaded consent form (2 pages) and combine with template
 * Upload contains: page 1 (signed) and page 2 (which is page 5 signed)
 * Final order: cover + uploaded-page-1 + template-2 + template-3 + template-4 + uploaded-page-2
 */
export async function processUploadedConsentForm(uploadedPdfBuffer: Buffer): Promise<Buffer> {
  // Load the uploaded PDF
  const uploadedPdf = await PDFDocument.load(uploadedPdfBuffer)

  // Verify it has exactly 2 pages
  const uploadedPageCount = uploadedPdf.getPageCount()
  if (uploadedPageCount !== 2) {
    throw new Error(`Expected 2 pages in uploaded PDF, but found ${uploadedPageCount}`)
  }

  // Create new PDF document for the final combined version
  const finalPdf = await PDFDocument.create()

  // 1. Add cover page from template
  const coverPath = join(process.cwd(), 'public', 'PDF', 'cover.pdf')
  const coverBytes = await readFile(coverPath)
  const coverPdf = await PDFDocument.load(coverBytes)
  const [coverPage] = await finalPdf.copyPages(coverPdf, [0])
  finalPdf.addPage(coverPage)

  // 2. Add page 1 from uploaded PDF (first scanned page)
  const [uploadedPage1] = await finalPdf.copyPages(uploadedPdf, [0])
  finalPdf.addPage(uploadedPage1)

  // 3. Add template pages 2, 3, 4
  for (const pageNum of [2, 3, 4]) {
    const templatePath = join(process.cwd(), 'public', 'PDF', `${pageNum}.pdf`)
    const templateBytes = await readFile(templatePath)
    const templatePdf = await PDFDocument.load(templateBytes)
    const [templatePage] = await finalPdf.copyPages(templatePdf, [0])
    finalPdf.addPage(templatePage)
  }

  // 4. Add page 2 from uploaded PDF (second scanned page - this becomes page 5)
  const [uploadedPage2] = await finalPdf.copyPages(uploadedPdf, [1])
  finalPdf.addPage(uploadedPage2)

  // Save the final combined PDF
  const finalPdfBytes = await finalPdf.save()
  return Buffer.from(finalPdfBytes)
}

/**
 * Validate that uploaded PDF has exactly 2 pages
 */
export async function validateConsentFormUpload(
  pdfBuffer: Buffer
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
  } catch {
    return {
      valid: false,
      error: 'Invalid PDF file or corrupted PDF.',
    }
  }
}
