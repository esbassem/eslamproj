import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const certDir = path.resolve(__dirname, '.cert');
const httpsKeyPath = path.join(certDir, 'dev-key.pem');
const httpsCertPath = path.join(certDir, 'dev-cert.pem');
const useHttps = process.env.VITE_DEV_HTTPS === '1'
  && fs.existsSync(httpsKeyPath)
  && fs.existsSync(httpsCertPath);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: useHttps
    ? {
      https: {
        key: fs.readFileSync(httpsKeyPath),
        cert: fs.readFileSync(httpsCertPath),
      },
    }
    : undefined,
});
