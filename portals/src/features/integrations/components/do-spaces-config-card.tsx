import { getDoSpacesStatus, saveDoSpaces, testDoSpaces } from '@/lib/actions/integrations'
import { S3CompatibleConfigCard } from './s3-compatible-config-card'

export function DoSpacesConfigCard() {
  return (
    <S3CompatibleConfigCard
      providerId="do-spaces"
      usageProviderId="do_spaces"
      label="DigitalOcean Spaces"
      description="S3-compatible object storage hosted by DigitalOcean."
      endpointPlaceholder="https://nyc3.digitaloceanspaces.com"
      regionPlaceholder="nyc3"
      publicUrlPlaceholder="optional"
      statusLoader={getDoSpacesStatus}
      saver={saveDoSpaces}
      tester={testDoSpaces}
    />
  )
}
