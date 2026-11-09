import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const API_OUT_DIR = path.resolve(ROOT_DIR, 'api');

console.log('=== Building Pharos dApp Support Agent ===');

if (!fs.existsSync(API_OUT_DIR)) {
  fs.mkdirSync(API_OUT_DIR, { recursive: true });
}

// Bundle Vercel serverless functions with esbuild
try {
  console.log('Bundling src/api/*.ts to api/ with esbuild...');
  execSync('npx esbuild src/api/*.ts --bundle --platform=node --format=esm --target=node20 --outdir=api', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  console.log('Build completed successfully.');
} catch (err: any) {
  console.error('Build error:', err.message);
  process.exit(1);
}
