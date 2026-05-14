import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // strictPort: true, // Bỏ strictPort để Vite tự tìm port trống
    // If you have a real backend, you can point this proxy there.
    // The UI also ships with a dev mock layer so it works without a backend.
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
})

