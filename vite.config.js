import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'molecular', test: /node_modules[\\/]3dmol/ }] } } } },
});
