import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

export default defineConfig(({ command }) => {
  const appVersion = command === 'build' ? createBuildVersion() : readCurrentVersion();

  return {
    plugins: [react(), appVersionPlugin(appVersion)],
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
  };
});
