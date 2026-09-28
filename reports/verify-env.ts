import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.DATABASE_URL

console.log('Checking DATABASE_URL...')
if (!url) {
  console.error('ERROR: DATABASE_URL is undefined or empty.')
} else {
  console.log('DATABASE_URL is present.')
  console.log('Length:', url.length)
  console.log('Starts with:', url.substring(0, 15))
  // Check if it looks like a neon url
  if (url.includes('neon.tech')) {
    console.log('Looks like a Neon URL.')
  } else {
    console.warn('WARNING: Does not look like a Neon URL (missing "neon.tech").')
  }
}
