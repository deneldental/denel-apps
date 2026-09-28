import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

function getRequiredEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var ${name}`)
  return v
}

function readEnvFile(filePath: string): Record<string, string> {
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = dotenv.parse(raw)
  const out: Record<string, string> = {}

  for (const [k, v] of Object.entries(parsed)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue
    if (k.startsWith('BWS_')) continue
    out[k] = typeof v === 'string' ? v : String(v ?? '')
  }
  return out
}

function writeSecretValueToBws(secretId: string, jsonValue: string) {
  const bwsBin = process.env.BWS_BIN || 'bws'
  execFileSync(bwsBin, ['secret', 'edit', secretId, '--value', jsonValue], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const secretId = getRequiredEnv('BWS_SECRET_ID')
const inFile = process.env.BWS_IN_FILE || '.env.local'
const inPath = path.isAbsolute(inFile) ? inFile : path.join(process.cwd(), inFile)

if (!fs.existsSync(inPath)) {
  throw new Error(`Env file not found: ${inPath}. Run env:pull first or create it.`)
}

const envVars = readEnvFile(inPath)
const jsonValue = JSON.stringify(envVars)

writeSecretValueToBws(secretId, jsonValue)
process.stdout.write(
  `Updated Bitwarden secret ${secretId} from ${inPath} (${Object.keys(envVars).length} vars)\n`
)
