const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

test('packaging resource and icon references exist', () => {
  const config = JSON.parse(fs.readFileSync('package.json', 'utf8')).build;
  for (const resource of config.extraResources) assert.ok(fs.existsSync(resource.from), resource.from);
  for (const platform of ['win', 'mac', 'linux']) {
    if (config[platform].icon) assert.ok(fs.existsSync(config[platform].icon), config[platform].icon);
  }
});

// Opt in against an actual electron-builder win-unpacked directory.
const packaged = process.env.CLIPFORGE_PACKAGE_DIR;
test('packaged archive contains production assets and the current main/preload', { skip: !packaged }, () => {
  const archive = path.join(packaged, 'resources', 'app.asar');
  const html = asar.extractFile(archive, 'dist/index.html').toString();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(match[1].startsWith('./'), match[1]);
    assert.ok(asar.extractFile(archive, path.join('dist', match[1])).length);
  }
  for (const file of ['electron/main.js', 'electron/preload.js']) {
    assert.equal(asar.extractFile(archive, path.normalize(file)).toString(), fs.readFileSync(file, 'utf8'));
  }
});

test('packaged ffmpeg and ffprobe execute without FFmpeg on PATH', { skip: !packaged }, () => {
  for (const binary of ['ffmpeg', 'ffprobe']) {
    const executable = path.join(packaged, 'resources', 'ffmpeg', 'win32', binary + '.exe');
    assert.ok(fs.existsSync(executable), executable);
    const output = execFileSync(executable, ['-version'], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') },
    });
    assert.match(output, new RegExp(binary + ' version'));
  }
});
