// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
// Frees common dev ports on Windows before starting
const { execSync } = require('child_process')

const ports = [3000, 3001, 3002, 5173, 5174, 5175, 5176, 5177, 8081, 19000, 19006, 19007]

function killOnWindows(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { stdio: 'pipe', encoding: 'utf8' })
    const pids = Array.from(new Set(out.split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/).pop())
      .filter(Boolean)))
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
        console.log(`Killed PID ${pid} on port ${port}`)
      } catch {}
    }
  } catch {}
}

if (process.platform === 'win32') {
  for (const port of ports) killOnWindows(port)
} else {
  console.log('kill-ports is currently implemented for Windows only; skipping')
}
