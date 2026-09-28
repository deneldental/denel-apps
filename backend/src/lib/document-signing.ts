/**
 * Document signing engine — admin-v1 CC.4.
 *
 * Given a template PDF + its field map + the captured values (text / checkbox /
 * signature PNG), draw each field onto the PDF, flatten, and return the bytes +
 * a content hash. Coordinates are PDF points with a bottom-left origin (what the
 * visual editor stores).
 */

import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import {
  documentFields,
  documentInstances,
  documentSigners,
  documentTemplates,
  type TemplateField,
} from '../db/schema'
import { readStoredFile } from './private-files'
import { uploadToCategory } from './storage-router'

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface FlattenInput {
  templateBytes: Uint8Array
  fields: TemplateField[]
  /** fieldId -> value. signature/initials: a PNG data URL or base64; checkbox: 'true'. */
  values: Record<string, string>
}

export async function flattenSignedPdf({
  templateBytes,
  fields,
  values,
}: FlattenInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()

  for (const field of fields) {
    const value = values[field.id]
    if (value == null || value === '') continue
    const page = pages[field.page]
    if (!page) continue

    try {
      if (field.type === 'signature' || field.type === 'initials') {
        const png = await embedPng(pdf, value)
        if (png) page.drawImage(png, { x: field.x, y: field.y, width: field.w, height: field.h })
      } else if (field.type === 'checkbox') {
        if (value === 'true' || value === 'on' || value === '1') {
          page.drawText('X', {
            x: field.x + 1,
            y: field.y + 1,
            size: Math.min(field.h, 14),
            font,
            color: rgb(0, 0, 0),
          })
        }
      } else {
        // text / name / address / date
        const size = Math.max(6, Math.min(field.h * 0.7, 12))
        page.drawText(sanitize(String(value)), {
          x: field.x + 1,
          y: field.y + (field.h - size) / 2,
          size,
          font,
          color: rgb(0, 0, 0),
        })
      }
    } catch {
      // One bad field (e.g. an unrenderable glyph) must not fail the whole document.
    }
  }

  // Flatten any embedded AcroForm so nothing stays editable.
  try {
    pdf.getForm().flatten()
  } catch {
    // no form — fine
  }

  return pdf.save()
}

// Helvetica is WinAnsi — drop anything it can't encode rather than throw.
function sanitize(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

async function embedPng(pdf: PDFDocument, value: string) {
  try {
    const base64 = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
    return await pdf.embedPng(Buffer.from(base64, 'base64'))
  } catch {
    return null
  }
}

/** Stalls/draws current field values on PDF and uploads the updated draft PDF. */
export async function stampFieldsAndSave(instanceId: string, db: any): Promise<void> {
  const [instance] = await db
    .select()
    .from(documentInstances)
    .where(eq(documentInstances.id, instanceId))
    .limit(1)
  if (!instance) throw new Error(`Document instance not found: ${instanceId}`)

  if (!instance.templateId) {
    throw new Error('Stamping not supported on custom uploaded documents without template')
  }

  const [template] = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, instance.templateId))
    .limit(1)
  if (!template) throw new Error(`Template not found: ${instance.templateId}`)

  const fields = await db
    .select()
    .from(documentFields)
    .where(eq(documentFields.instanceId, instanceId))

  const templateFields: TemplateField[] = fields.map((f: any) => ({
    id: f.id,
    page: f.page,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    type: f.type as any,
  }))

  const values: Record<string, string> = {}
  for (const f of fields) {
    if (f.value !== null && f.value !== undefined) {
      values[f.id] = f.value
    }
  }

  let templateBytes: Uint8Array
  try {
    templateBytes = await readStoredFile(template.pdfUrl)
  } catch (err) {
    throw new Error(`Failed to fetch template PDF from ${template.pdfUrl}`, { cause: err })
  }

  const stampedBytes = await flattenSignedPdf({
    templateBytes,
    fields: templateFields,
    values,
  })

  const category =
    instance.subjectType === 'patient'
      ? 'patient_records'
      : instance.subjectType === 'staff'
        ? 'staff'
        : 'system_docs'
  const { url } = await uploadToCategory(
    category as any,
    `documents/${instance.id}.pdf`,
    Buffer.from(stampedBytes),
    'application/pdf'
  )

  await db
    .update(documentInstances)
    .set({ signedPdfUrl: url })
    .where(eq(documentInstances.id, instance.id))
}

/** If all signers are done, appends certificate audit page, updates status to completed, saves final PDF. */
export async function maybeCompleteDocument(instanceId: string, db: any): Promise<void> {
  const [instance] = await db
    .select()
    .from(documentInstances)
    .where(eq(documentInstances.id, instanceId))
    .limit(1)
  if (!instance) throw new Error(`Document instance not found: ${instanceId}`)

  const signers = await db
    .select()
    .from(documentSigners)
    .where(eq(documentSigners.instanceId, instanceId))
    .orderBy(documentSigners.order)

  const allSigned = signers.every((s: any) => s.status === 'SIGNED')
  if (!allSigned) {
    // If not all signed, update the status to partially_signed if not already.
    if (instance.status !== 'partially_signed') {
      await db
        .update(documentInstances)
        .set({ status: 'partially_signed' })
        .where(eq(documentInstances.id, instanceId))
    }
    return
  }

  if (!instance.signedPdfUrl) {
    throw new Error('No current signed PDF URL found to finalize')
  }

  let currentPdfBytes: Uint8Array
  try {
    currentPdfBytes = await readStoredFile(instance.signedPdfUrl)
  } catch (err) {
    throw new Error(`Failed to fetch current signed PDF from ${instance.signedPdfUrl}`, {
      cause: err,
    })
  }

  const existingPdf = await PDFDocument.load(currentPdfBytes)
  const font = await existingPdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await existingPdf.embedFont(StandardFonts.HelveticaBold)
  const page = existingPdf.addPage([595.28, 841.89]) // A4 Size

  // Draw title and header
  page.drawText('Document Audit Certificate', {
    x: 50,
    y: 770,
    size: 20,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  })
  page.drawText(`Document ID: ${instance.id}`, {
    x: 50,
    y: 745,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  })
  page.drawText(`Document Title: ${instance.title}`, {
    x: 50,
    y: 730,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  })

  page.drawLine({
    start: { x: 50, y: 710 },
    end: { x: 545, y: 710 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  })

  let currentY = 670
  for (const signer of signers) {
    page.drawRectangle({
      x: 50,
      y: currentY - 110,
      width: 495,
      height: 120,
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 1,
      color: rgb(0.98, 0.98, 0.98),
    })

    page.drawText(`Signer: ${signer.name}`, {
      x: 65,
      y: currentY - 15,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    })
    page.drawText(`Email: ${signer.email}`, {
      x: 65,
      y: currentY - 32,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    })
    page.drawText(`Status: ${signer.status}`, {
      x: 65,
      y: currentY - 49,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    })
    page.drawText(
      `Signed At: ${signer.signedAt ? new Date(signer.signedAt).toLocaleString() : 'N/A'}`,
      { x: 65, y: currentY - 66, size: 10, font, color: rgb(0.3, 0.3, 0.3) }
    )
    page.drawText(`IP Address: ${signer.ipAddress || 'N/A'}`, {
      x: 65,
      y: currentY - 83,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    })
    page.drawText(`User Agent: ${signer.userAgent || 'N/A'}`, {
      x: 65,
      y: currentY - 100,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    })

    currentY -= 140
  }

  page.drawText(
    'This document was signed electronically. This certificate forms part of the immutable document audit trail.',
    {
      x: 50,
      y: 50,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    }
  )

  const completedPdfBytes = await existingPdf.save()
  const hash = sha256Hex(completedPdfBytes)

  const category =
    instance.subjectType === 'patient'
      ? 'patient_records'
      : instance.subjectType === 'staff'
        ? 'staff'
        : 'system_docs'
  const { url } = await uploadToCategory(
    category as any,
    `documents/${instance.id}.pdf`,
    Buffer.from(completedPdfBytes),
    'application/pdf'
  )

  const now = new Date()
  await db
    .update(documentInstances)
    .set({
      status: 'completed',
      signedPdfUrl: url,
      contentHash: hash,
      completedAt: now,
    })
    .where(eq(documentInstances.id, instance.id))
}
