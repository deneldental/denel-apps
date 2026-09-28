// Branding config — single source of truth for clinic name, logo, contact info,
// SMS sender ID, email From, social handles, theme color. Stored under the
// `integration_branding` KV key.
//
// Read priority (layered fallback):
//   1. integration_branding KV (the new, full config)
//   2. clinic_info KV (legacy, partial — name/phone/address only)
//   3. env vars (CLINIC_NAME, CLINIC_PHONE, CLINIC_ADDRESS, HUBTEL_SENDER_ID, RESEND_FROM_EMAIL)
//   4. literal defaults
//
// This means existing installs keep working, env-var deployments keep working,
// and new installs get sensible defaults out of the box.

import { eq } from 'drizzle-orm'
import { env } from '../config/env'
import { getDb } from '../db'
import { clinicSettings } from '../db/schema'

export const BRANDING_KEY = 'integration_branding'

export type BrandingConfig = {
  /** Long-form name, e.g. "Denel Dental Clinic". */
  name: string
  /** Short name for compact UI / SMS sender contexts, e.g. "Denel". */
  shortName: string
  /** Public URL of uploaded logo, or null. */
  logoUrl: string | null
  /** Public URL of uploaded favicon, or null. */
  faviconUrl: string | null
  /** Square/icon logo — sidebar collapsed, badge contexts (SVG/PNG/WebP). */
  logoIconUrl: string | null
  /** Wide horizontal logo — sidebar expanded, login pages (SVG/PNG/WebP). */
  logoHorizontalUrl: string | null
  /**
   * Background image URL for the portal login page. Kept as the FIRST entry of
   * `portalLoginImageUrls` so older readers (the kiosk, the public endpoint's
   * consumers) keep working unchanged.
   */
  portalLoginImageUrl: string | null
  /**
   * Portal login panel photos, in order. The panel cross-fades through them;
   * one entry renders as a still. Empty means "use the shipped Denel set".
   */
  portalLoginImageUrls: string[]
  /** CSS object-position for the portal login background image. */
  portalLoginImagePosition: string
  /** Background image URL for the PWA (app.deneldental.com) login page. */
  pwaLoginImageUrl: string | null
  /** CSS object-position for the PWA login background image. */
  pwaLoginImagePosition: string
  /** Accent/secondary color hex, e.g. "#8b5cf6". */
  accentColor: string
  /** SMS sender ID. Hubtel limit: 11 chars. */
  smsSenderId: string
  /** Email From — display name + address, combined as `Name <addr>` when sent. */
  emailFromName: string
  emailFromAddress: string
  /** Ordered list of clinic phones, primary first. */
  phones: string[]
  /** Public contact email, or null. */
  email: string | null
  /** Postal/physical address, or null. */
  address: string | null
  /** Public website URL, or null. */
  website: string | null
  /** Copyright holder for legal footer (defaults to `name` if blank). */
  copyrightHolder: string
  /** Brand theme color as hex, e.g. "#16a34a". */
  themeColor: string
  social: {
    facebook?: string
    instagram?: string
    tiktok?: string
    youtube?: string
    linkedin?: string
    snapchat?: string
  }
}

function literalDefaults(): BrandingConfig {
  return {
    name: env.CLINIC_NAME ?? 'Denel Dental Clinic',
    shortName: 'Denel',
    logoUrl: null,
    faviconUrl: null,
    logoIconUrl: null,
    logoHorizontalUrl: null,
    portalLoginImageUrl: null,
    portalLoginImageUrls: [],
    portalLoginImagePosition: 'center center',
    pwaLoginImageUrl: null,
    pwaLoginImagePosition: 'center center',
    accentColor: '#B8873A',
    smsSenderId: env.HUBTEL_SENDER_ID ?? 'Denel',
    emailFromName: 'Denel Dental',
    emailFromAddress: env.RESEND_FROM_EMAIL ?? 'info@deneldental.com',
    phones: env.CLINIC_PHONE ? [env.CLINIC_PHONE] : [],
    email: null,
    address: env.CLINIC_ADDRESS ?? null,
    website: null,
    copyrightHolder: env.CLINIC_NAME ?? 'Denel Dental Clinic',
    themeColor: '#24296a',
    social: {},
  }
}

/**
 * Keep the singular and plural login-image fields in step.
 *
 * Configs written before the panel supported several photos only carry
 * `portalLoginImageUrl`, so treat that as a one-frame list. Going the other
 * way, `portalLoginImageUrl` always mirrors the first frame so nothing that
 * reads the old field has to change.
 */
function normalizeLoginImages(cfg: BrandingConfig): BrandingConfig {
  const stored = Array.isArray(cfg.portalLoginImageUrls) ? cfg.portalLoginImageUrls : []
  const urls = stored.filter((u) => typeof u === 'string' && u.trim().length > 0)
  const effective =
    urls.length > 0 ? urls : cfg.portalLoginImageUrl ? [cfg.portalLoginImageUrl] : []
  return {
    ...cfg,
    portalLoginImageUrls: effective,
    portalLoginImageUrl: effective[0] ?? null,
  }
}

/**
 * Read the branding config. Always returns a fully-populated object — fields
 * fall back through the layered chain so callers never have to handle nulls
 * for `name` / `smsSenderId` etc.
 */
export async function getBranding(): Promise<BrandingConfig> {
  const db = getDb(env.DATABASE_URL)

  // Layer 1: integration_branding (the only configurable source)
  const [brandingRow] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.key, BRANDING_KEY))
    .limit(1)
  const defaults = literalDefaults()
  if (brandingRow?.value) {
    const stored = brandingRow.value as Partial<BrandingConfig>
    return normalizeLoginImages({
      ...defaults,
      ...stored,
      // Ensure nested social object is preserved without dropping keys
      social: { ...defaults.social, ...(stored.social ?? {}) },
      // copyrightHolder defaults to name if blank
      copyrightHolder: stored.copyrightHolder?.trim()
        ? stored.copyrightHolder
        : (stored.name ?? defaults.name),
    })
  }

  // Fallback: env-derived defaults baked into literalDefaults(). The legacy
  // `clinic_info` KV was retired with the Settings cleanup — admins manage
  // identity exclusively via Integrations → Branding now.
  return normalizeLoginImages(defaults)
}

/**
 * Persist branding config. Full-replace: caller is expected to pass the
 * complete shape. The integrations PUT route handles field-level merging
 * with the existing config before calling this.
 */
export async function setBranding(value: BrandingConfig, updatedById: string): Promise<void> {
  const db = getDb(env.DATABASE_URL)
  const [existing] = await db
    .select()
    .from(clinicSettings)
    .where(eq(clinicSettings.key, BRANDING_KEY))
    .limit(1)
  if (existing) {
    await db
      .update(clinicSettings)
      .set({ value, updatedById, updatedAt: new Date() })
      .where(eq(clinicSettings.key, BRANDING_KEY))
  } else {
    await db.insert(clinicSettings).values({ key: BRANDING_KEY, value, updatedById })
  }
}

/** Convenience: assemble the email From header (`Name <addr>` form). */
export function emailFromHeader(b: BrandingConfig): string {
  return `${b.emailFromName} <${b.emailFromAddress}>`
}

/**
 * The From header every clinic email goes out with: Integrations → Branding,
 * else RESEND_FROM_EMAIL, else the literal default. A failed Branding lookup
 * still yields the clinic's own address, never a placeholder.
 */
export async function getEmailFrom(): Promise<string> {
  return emailFromHeader(await getBranding().catch(() => literalDefaults()))
}
