import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'app/msix/Package.appxmanifest');
const packagingScriptPath = resolve(repoRoot, 'scripts/build-msix.ps1');

const manifest = await readFile(manifestPath, 'utf8');
const packagingScript = await readFile(packagingScriptPath, 'utf8');
const appVersion = JSON.parse(await readFile(resolve(repoRoot, 'app/package.json'), 'utf8')).version;

assert.match(manifest, /<Identity\b[^>]*\bName="[^"\s]+"/);
assert.match(manifest, /<Identity\b[^>]*\bPublisher="[^"\s]+"/);
assert.equal(manifest.match(/<Identity\b[^>]*\bVersion="([^"]+)"/)?.[1], `${appVersion}.0`);
assert.match(manifest, /<TargetDeviceFamily\b[^>]*\bName="Windows\.Desktop"/);
assert.match(manifest, /<rescap:Capability\b[^>]*\bName="runFullTrust"/);
assert.match(manifest, /\bId="EiSen"/);
assert.match(manifest, /\bExecutable="\$targetnametoken\$\.exe"/);
assert.match(manifest, /\buap10:RuntimeBehavior="packagedClassicApp"/);
assert.match(manifest, /\buap10:TrustLevel="mediumIL"/);
assert.doesNotMatch(manifest, /(__PARTNER_CENTER_|<Partner Center|\bTBD\b|\bTODO\b)/i);
assert.doesNotMatch(manifest, /(?:BEGIN (?:RSA |EC )?PRIVATE KEY|\.pfx\b|password\s*=)/i);
assert.match(packagingScript, /assets[\\/]branding[\\/]eisen-mark-on-dark-1024\.png/);
assert.match(packagingScript, /PSIsContainer/);
assert.doesNotMatch(packagingScript, /Get-Item[^\r\n]*-File/);

const assetReferences = [
  ...manifest.matchAll(/(?:Logo|Wide310x150Logo|Square310x310Logo|Square71x71Logo|Square44x44Logo|Square150x150Logo)="([^"]+)"/g),
].map((match) => match[1]);

assert.ok(assetReferences.length > 0, 'manifest must reference package assets');

for (const assetReference of new Set(assetReferences)) {
  assert.ok(!assetReference.includes('..'), `asset path must stay inside package: ${assetReference}`);
  const assetPath = resolve(dirname(manifestPath), assetReference.replaceAll('\\', '/'));
  await access(assetPath);
}

console.log('msix manifest contract: ok');
