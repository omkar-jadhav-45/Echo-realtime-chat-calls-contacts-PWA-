// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
#!/usr/bin/env node
/*
  Apache-2.0 header injector
  - Prepends a short SPDX + license header to source files.
  - Usage:
    node scripts/add-headers.js [--staged]
  - By default, scans the repo for supported extensions.
*/
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const exts = ['.ts', '.tsx', '.js', '.jsx', '.css', '.rs']
const ignoreDirs = new Set(['node_modules', 'dist', 'build', 'target', '.git'])

const headerLines = {
  ts: [
    '// SPDX-License-Identifier: Apache-2.0',
    '// Copyright 2025 Echo contributors',
    ''
  ],
  tsx: [
    '// SPDX-License-Identifier: Apache-2.0',
    '// Copyright 2025 Echo contributors',
    ''
  ],
  js: [
    '// SPDX-License-Identifier: Apache-2.0',
    '// Copyright 2025 Echo contributors',
    ''
  ],
  jsx: [
    '// SPDX-License-Identifier: Apache-2.0',
    '// Copyright 2025 Echo contributors',
    ''
  ],
  css: [
    '/* SPDX-License-Identifier: Apache-2.0 */',
    '/* Copyright 2025 Echo contributors */',
    ''
  ],
  rs: [
    '// SPDX-License-Identifier: Apache-2.0',
    '// Copyright 2025 Echo contributors',
    ''
  ]
}

function hasHeader(content) {
  return content.startsWith('// SPDX-License-Identifier: Apache-2.0') || content.startsWith('/* SPDX-License-Identifier: Apache-2.0 */')
}

function inject(file) {
  const ext = path.extname(file).slice(1)
  const lines = headerLines[ext]
  if (!lines) return
  const content = fs.readFileSync(file, 'utf8')
  if (hasHeader(content)) return
  const updated = lines.join('\n') + content
  fs.writeFileSync(file, updated, 'utf8')
}

function walk(dir, out=[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (ignoreDirs.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (exts.includes(path.extname(p))) out.push(p)
  }
  return out
}

function run() {
  const staged = process.argv.includes('--staged')
  let files = []
  if (staged) {
    try {
      const out = execSync('git diff --cached --name-only', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      files = out.split(/\r?\n/).filter(Boolean).filter(f => exts.includes(path.extname(f)))
    } catch {}
  } else {
    files = walk(process.cwd())
  }
  for (const f of files) {
    try { inject(f) } catch {}
  }
  if (staged && files.length) {
    try { execSync('git add ' + files.map(f => `'${f.replace(/'/g, "'\\''")}'`).join(' '), { stdio: 'ignore' }) } catch {}
  }
}

run()
