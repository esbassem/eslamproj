import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { visualizer } from 'rollup-plugin-visualizer';

function createBuildVersion() {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '.')
    .replace(/\.\d{3}Z$/, 'Z');

  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return `${timestamp}.${commit}`;
  } catch {
    return timestamp;
  }
}

function appVersionPlugin(version) {
  return {
    name: 'app-version',
    apply: 'build',
    buildStart() {
      const versionFile = path.resolve(__dirname, 'public/version.json');
      fs.mkdirSync(path.dirname(versionFile), { recursive: true });
      fs.writeFileSync(versionFile, `${JSON.stringify({ version }, null, 2)}\n`);
    },
  };
}

function readCurrentVersion() {
  try {
    const versionFile = path.resolve(__dirname, 'public/version.json');
    const { version } = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    return typeof version === 'string' ? version : 'development';
  } catch {
    return 'development';
  }
}

const certDir = path.resolve(__dirname, '.cert');
const httpsKeyPath = path.join(certDir, 'dev-key.pem');
const httpsCertPath = path.join(certDir, 'dev-cert.pem');
const useHttps = process.env.VITE_DEV_HTTPS === '1'
  && fs.existsSync(httpsKeyPath)
  && fs.existsSync(httpsCertPath);

export default defineConfig(({ command, mode }) => {
  const appVersion = command === 'build' ? createBuildVersion() : readCurrentVersion();

  return {
    plugins: [
      react(),
      appVersionPlugin(appVersion),
      ...(mode === 'analyze' ? [visualizer({ filename: 'dist/bundle-report.html', gzipSize: true, brotliSize: true })] : []),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: true,
      ...(useHttps
        ? {
            https: {
              key: fs.readFileSync(httpsKeyPath),
              cert: fs.readFileSync(httpsCertPath),
            },
          }
        : {}),
    },
    preview: {
      host: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) return 'vendor-react';
            if (id.includes('/@supabase/')) return 'vendor-supabase';
            if (id.includes('/@radix-ui/')) return 'vendor-radix';
            if (id.includes('/framer-motion/')) return 'vendor-motion';
            if (id.includes('/react-onesignal/') || id.includes('/onesignal/')) return 'vendor-onesignal';
            return undefined;
          },
        },
      },
    },
  };
});
