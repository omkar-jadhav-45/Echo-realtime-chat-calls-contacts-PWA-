// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
const http = require('http')
const { exec } = require('child_process')

const ports = [19000, 19002, 19006, 19007, 8082]
const timeoutMs = 30000
const startTime = Date.now()

function check(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy(new Error('timeout'))
      resolve(false)
    })
  })
}

async function main() {
  while (Date.now() - startTime < timeoutMs) {
    for (const port of ports) {
      const url = `http://localhost:${port}/`
      // eslint-disable-next-line no-await-in-loop
      const ok = await check(url)
      if (ok) {
        // Open in default browser on Windows
        const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
        exec(cmd)
        console.log(`Opened Expo Dev Tools at ${url}`)
        return
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1500))
  }
  console.log('Expo Dev Tools not detected within timeout; skipping auto-open')
}

main().catch(() => {})
