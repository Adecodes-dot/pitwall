// electron-builder drops any `node_modules` folder from extraResources; the companion's native addons
// must live at resources/app/node_modules so Node resolves them from the bundle. Copy them in after packing.
const { cpSync, existsSync } = require('node:fs');
const path = require('node:path');
module.exports = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, 'dist', 'pkg', 'node_modules');
  const dst = path.join(context.appOutDir, 'resources', 'app', 'node_modules');
  if (!existsSync(src)) throw new Error(`afterPack: ${src} missing — run npm run bundle:server first`);
  cpSync(src, dst, { recursive: true });
  console.log(`  • afterPack: copied native packages → ${dst}`);
};
