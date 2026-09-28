import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type JsonObject = Record<string, unknown>

function getRequiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var ${name}`)
  return v
}

function envEscape(value: unknown): string {
  let s = typeof value === 'string' ? value : String(value ?? '')
  s = s.replace(/\r\n/g, '\n')
  s = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return `"${s}"`
}

function readSecretValueFromBws(secretId: string): string {
  const bwsBin = process.env.BWS_BIN || 'bws'
  const raw = execFileSync(bwsBin, ['secret', 'get', secretId, '--output', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // If the user configured `--output none` globally or something unexpected,
    // surface a helpful error.
    throw new Error(`Unexpected bws output (expected JSON). Got: ${raw.slice(0, 200)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Unexpected bws output: not an object')
  }

  const value = (parsed as { value?: unknown }).value
  if (typeof value !== 'string') {
    throw new Error('Unexpected bws output: missing string `value`')
  }
  return value
}

function parseEnvJson(jsonText: string): Record<string, string> {
  let obj: unknown
  try {
    obj = JSON.parse(jsonText)
  } catch {
    throw new Error(
      'Bitwarden secret `value` is not valid JSON. Store your env vars as a JSON object like {"KEY":"VALUE"}.'
    )
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Bitwarden secret JSON must be an object of KEY: VALUE pairs.')
  }

  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj as JsonObject)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      throw new Error(`Invalid env var name in JSON: ${k}`)
    }
    out[k] = typeof v === 'string' ? v : String(v ?? '')
  }
  return out
}

function writeEnvFile(targetPath: string, vars: Record<string, string>) {
  const keys = Object.keys(vars).sort((a, b) => a.localeCompare(b))
  const lines = keys.map((k) => `${k}=${envEscape(vars[k])}`)
  fs.writeFileSync(targetPath, `${lines.join('\n')}\n`, 'utf8')
}

const secretId = getRequiredEnv('BWS_SECRET_ID')
const outFile = process.env.BWS_OUT_FILE || '.env.local'
const outPath = path.isAbsolute(outFile) ? outFile : path.join(process.cwd(), outFile)

const secretValue = readSecretValueFromBws(secretId)
const vars = parseEnvJson(secretValue)
writeEnvFile(outPath, vars)

process.stdout.write(`Wrote ${Object.keys(vars).length} vars to ${outPath}\n`)
