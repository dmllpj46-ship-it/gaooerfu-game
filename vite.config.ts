import { defineConfig } from 'vite'

export default defineConfig({
  // 相对路径，产物可直接扔到任意静态托管（Cloudflare Pages / GitHub Pages）的子目录
  base: './',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
