import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Post-build step for the Chrome extension.
// Vite already copies everything in public/ (including manifest.json) into dist/,
// so this script only verifies the build output and copies optional icons.
function buildExtension() {
  const distDir = path.join(__dirname, '../dist');

  const required = ['manifest.json', 'content-script.js', 'index.html', 'main.js'];
  const missing = required.filter((f) => !fs.existsSync(path.join(distDir, f)));
  if (missing.length > 0) {
    console.error('✗ Missing expected build output:', missing.join(', '));
    process.exit(1);
  }

  // Copy icons if present.
  const iconsDir = path.join(__dirname, '../public/icons');
  if (fs.existsSync(iconsDir)) {
    const distIconsDir = path.join(distDir, 'icons');
    fs.mkdirSync(distIconsDir, { recursive: true });
    for (const file of fs.readdirSync(iconsDir)) {
      fs.copyFileSync(path.join(iconsDir, file), path.join(distIconsDir, file));
    }
    console.log('✓ Copied icons');
  }

  console.log('✓ Extension build complete — load the dist/ folder as an unpacked extension in Chrome');
}

buildExtension();
