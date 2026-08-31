import { chromium } from 'playwright'
import fs from 'node:fs'
const [, , inp, outp, w, h] = process.argv
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: +w || 1200, height: +h || 900 } })
await p.setContent(`<body style="margin:0">${fs.readFileSync(inp, 'utf8')}</body>`)
await p.screenshot({ path: outp, fullPage: true })
await b.close()
