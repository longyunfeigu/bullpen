import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { electronBinaryPath } = require('../../scripts/after-pack.cjs') as {
  electronBinaryPath: (context: {
    appOutDir: string;
    electronPlatformName: string;
    packager: { appInfo: { productFilename: string }; executableName?: string };
  }) => string;
};

function context(platform: string, executableName?: string) {
  return {
    appOutDir: join('release', `${platform}-unpacked`),
    electronPlatformName: platform,
    packager: {
      appInfo: { productFilename: 'Charter' },
      executableName,
    },
  };
}

describe('electron-builder afterPack binary resolution', () => {
  it('uses the platform packager executable name on Linux', () => {
    expect(electronBinaryPath(context('linux', 'charter'))).toBe(
      join('release', 'linux-unpacked', 'charter'),
    );
  });

  it('uses product filename conventions on macOS and Windows', () => {
    expect(electronBinaryPath(context('darwin'))).toBe(
      join('release', 'darwin-unpacked', 'Charter.app', 'Contents', 'MacOS', 'Charter'),
    );
    expect(electronBinaryPath(context('win32'))).toBe(
      join('release', 'win32-unpacked', 'Charter.exe'),
    );
  });
});
