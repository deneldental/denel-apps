import { describe, expect, it } from 'vitest'
import { describeDbFlavor } from '../../src/lib/db-flavor'

describe('describeDbFlavor — which database is this process on', () => {
  it('classifies the local Docker Postgres', () => {
    expect(describeDbFlavor('postgresql://framada:framada@localhost:5432/framada')).toEqual({
      provider: 'docker',
      label: 'Docker',
    })
    expect(describeDbFlavor('postgresql://u:p@127.0.0.1:5432/db').provider).toBe('docker')
    expect(describeDbFlavor('postgresql://u:p@host.docker.internal:5432/db').provider).toBe(
      'docker'
    )
  })

  it('classifies Neon, including the -pooler host the dev config uses', () => {
    const pooled =
      'postgresql://neondb_owner:secret@ep-sparkling-credit-alieaf5q-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require'
    expect(describeDbFlavor(pooled)).toEqual({ provider: 'neon', label: 'Neon' })

    const direct =
      'postgresql://neondb_owner:secret@ep-sparkling-credit-alieaf5q.c-3.eu-central-1.aws.neon.tech/neondb'
    expect(describeDbFlavor(direct).provider).toBe('neon')
  })

  it('classifies the DigitalOcean production cluster', () => {
    const url = 'postgresql://u:p@db-postgresql-fra1-123.b.db.ondigitalocean.com:25060/defaultdb'
    expect(describeDbFlavor(url)).toEqual({ provider: 'digitalocean', label: 'DigitalOcean' })
  })

  it('never throws on junk or missing input — it only feeds a diagnostic badge', () => {
    expect(describeDbFlavor(undefined).provider).toBe('unknown')
    expect(describeDbFlavor('').provider).toBe('unknown')
    expect(describeDbFlavor('not a url').provider).toBe('unknown')
    expect(describeDbFlavor('postgresql://u:p@some-other-host.example.com/db').provider).toBe(
      'unknown'
    )
  })

  it('never leaks credentials or the host in its output', () => {
    const url = 'postgresql://neondb_owner:sup3rs3cret@ep-abc.eu-central-1.aws.neon.tech/neondb'
    const serialized = JSON.stringify(describeDbFlavor(url))
    expect(serialized).not.toContain('sup3rs3cret')
    expect(serialized).not.toContain('neondb_owner')
    expect(serialized).not.toContain('ep-abc')
  })
})
