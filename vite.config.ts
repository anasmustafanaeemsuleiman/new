import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base: './'` keeps asset URLs relative, so the same build works at
//   https://<user>.github.io/<repo>/   and   https://<user>.github.io/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '0.0.0.0', port: 3000 },
})
