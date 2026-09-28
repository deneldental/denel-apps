import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const s3Client = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT,
  region: process.env.DO_SPACES_REGION,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY!,
    secretAccessKey: process.env.DO_SPACES_SECRET!,
  },
})

interface UploadExpenseFileOptions {
  file: File
  category: string
  paidTo?: string | null
  date: Date
  bucketName?: string
}

export async function uploadExpenseFile({
  file,
  category,
  paidTo,
  date,
  bucketName = process.env.DO_RECORDS_BUCKET!,
}: UploadExpenseFileOptions): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    console.log('[UPLOAD] Starting file upload...')
    console.log('[UPLOAD] File name:', file.name)
    console.log('[UPLOAD] File size:', file.size, 'bytes')
    console.log('[UPLOAD] Category:', category)
    console.log('[UPLOAD] Bucket:', bucketName)
    console.log('[UPLOAD] Endpoint:', process.env.DO_SPACES_ENDPOINT)
    console.log('[UPLOAD] Region:', process.env.DO_SPACES_REGION)
    console.log(
      '[UPLOAD] Has credentials:',
      !!process.env.DO_SPACES_KEY && !!process.env.DO_SPACES_SECRET
    )

    const buffer = Buffer.from(await file.arrayBuffer())

    // Extract file extension
    const fileExtension = file.name.split('.').pop() || 'pdf'

    // Format date components
    const year = date.getFullYear()
    const monthNames = [
      'JANUARY',
      'FEBRUARY',
      'MARCH',
      'APRIL',
      'MAY',
      'JUNE',
      'JULY',
      'AUGUST',
      'SEPTEMBER',
      'OCTOBER',
      'NOVEMBER',
      'DECEMBER',
    ]
    const month = monthNames[date.getMonth()]
    const day = date.getDate()

    // Create standardized filename
    // Format: category_paidTo_day_month_year.extension
    const categorySlug = category.toLowerCase().replace(/\s+/g, '_')
    const paidToSlug = paidTo ? paidTo.toLowerCase().replace(/\s+/g, '_') : ''
    const dayOrdinal = `${day}${getOrdinalSuffix(day)}`
    const monthLower = month.toLowerCase()

    let fileName = `${categorySlug}`
    if (paidToSlug) {
      fileName += `_${paidToSlug}`
    }
    fileName += `_${dayOrdinal}_${monthLower}_${year}.${fileExtension}`

    // Create folder path: YEAR/MONTH/filename
    const folderPath = `${year}/${month}/${fileName}`

    console.log('[UPLOAD] Generated path:', folderPath)

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: folderPath,
      Body: buffer,
      ACL: 'public-read',
      ContentType: file.type,
    })

    console.log('[UPLOAD] Sending to S3...')
    await s3Client.send(command)
    console.log('[UPLOAD] Upload successful!')

    const url = `${process.env.DO_SPACES_ENDPOINT}/${bucketName}/${folderPath}`
    console.log('[UPLOAD] File URL:', url)

    return { success: true, url }
  } catch (error) {
    console.error('[UPLOAD] Error uploading file:', error)
    if (error instanceof Error) {
      console.error('[UPLOAD] Error message:', error.message)
      console.error('[UPLOAD] Error stack:', error.stack)
    }
    return { success: false, error: 'Failed to upload file' }
  }
}

function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

// Keep the old uploadFile function for backward compatibility with other modules
export async function uploadFile(
  file: File,
  bucketName: string = process.env.DO_RECORDS_BUCKET!
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = `${Date.now()}-${file.name.replace(/\s+/g, '-')}`

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: buffer,
      ACL: 'public-read',
      ContentType: file.type,
    })

    await s3Client.send(command)

    const url = `${process.env.DO_SPACES_ENDPOINT}/${bucketName}/${fileName}`

    return { success: true, url }
  } catch (error) {
    console.error('Error uploading file:', error)
    return { success: false, error: 'Failed to upload file' }
  }
}
