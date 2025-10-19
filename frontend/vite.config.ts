// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Allow building under a subpath (e.g., GitHub Pages project site /<repo>/)
  base: process.env.BASE_PATH || '/',
  server: { port: 5173 }
})
