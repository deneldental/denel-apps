import { getR2Status, saveR2, testR2 } from '@/lib/actions/integrations'
import { S3CompatibleConfigCard } from './s3-compatible-config-card'

export function R2ConfigCard() {
  return (
    <S3CompatibleConfigCard
      providerId="r2"
      usageProviderId="r2"
      label="Cloudflare R2"
      description="S3-compatible object storage: a public bucket for branding, a private bucket for everything else."
      endpointPlaceholder="https://<account-id>.r2.cloudflarestorage.com"
      regionPlaceholder="auto"
      // REQUIRED for R2 (unlike DO Spaces): the S3 endpoint above only answers
      // signed requests, so branding needs the public bucket's R2.dev URL or a
      // custom domain. Private files are served through short-lived signed links.
      publicUrlPlaceholder="https://pub-xxxx.r2.dev — required"
      withPrivateBucket
      statusLoader={getR2Status}
      saver={saveR2}
      tester={testR2}
    />
  )
}
