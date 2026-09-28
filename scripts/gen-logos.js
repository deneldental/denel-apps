const fs = require('fs')
const logoPng = fs
  .readFileSync('f:/2026/DEV PROJECTS/framada-latest/packages/assets/src/logo.png')
  .toString('base64')
const logoSvg = fs
  .readFileSync('f:/2026/DEV PROJECTS/framada-latest/packages/assets/src/logo-icon.svg')
  .toString('base64')

const content = `export const defaultLogo = 'data:image/png;base64,${logoPng}';\nexport const defaultLogoIcon = 'data:image/svg+xml;base64,${logoSvg}';\n`

fs.writeFileSync('f:/2026/DEV PROJECTS/framada-latest/backend/src/lib/default-logos.ts', content)
