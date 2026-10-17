import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pageUrl, parseOptions, SCENE } from './headset-emulator.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('headset emulator check options', () => {
  it('takes a named Chrome, else CHROME_BINARY, else the installed one, and refuses without any', () => {
    expect(parseOptions(['--binary=/chrome'], {}, () => false).binary).toBe('/chrome');
    expect(parseOptions([], { CHROME_BINARY: '/env-chrome' }, () => false).binary).toBe('/env-chrome');
    expect(parseOptions([], {}, () => true).binary).toMatch(/Google Chrome$/);
    expect(() => parseOptions([], {}, () => false)).toThrow(/--binary/);
  });

  it('writes under build/ only, in a new folder by default', () => {
    const options = parseOptions(['--binary=/chrome'], {}, () => false);
    expect(options.output.startsWith(path.join(root, 'build', 'headset') + path.sep)).toBe(true);
    expect(parseOptions(['--binary=/chrome', '--output=build/headset/mine'], {}, () => false).output).toBe(path.join(root, 'build/headset/mine'));
    expect(() => parseOptions(['--binary=/chrome', '--output=../elsewhere'], {}, () => false)).toThrow(/build/);
  });

  it('starts its own dev server unless given a page, and refuses unknown or repeated options', () => {
    expect(parseOptions(['--binary=/chrome'], {}, () => false).url).toBeNull();
    expect(parseOptions(['--binary=/chrome', '--url=http://127.0.0.1:5173/app/'], {}, () => false).url?.href).toBe('http://127.0.0.1:5173/app/');
    expect(() => parseOptions(['--browser=firefox'], {}, () => true)).toThrow(/Unknown/);
    expect(() => parseOptions(['--binary=/a', '--binary=/b'], {}, () => true)).toThrow(/repeated/);
  });

  it('opens the page with the emulated headset, the test hooks and the linked pair, keeping what the page had', () => {
    const url = pageUrl('http://127.0.0.1:5173/tour/minneapolis/?renderer=auto');
    expect(url.pathname).toBe('/tour/minneapolis/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ renderer: 'auto', headsetEmulator: 'quest3', panoramaTest: '1', scene: SCENE });
  });

  it('keeps a page\'s own scene when asked to', () => {
    expect(parseOptions(['--binary=/chrome'], {}, () => false).scene).toBe(SCENE);
    expect(parseOptions(['--binary=/chrome', '--scene=page'], {}, () => false).scene).toBe('page');
    expect(pageUrl('http://localhost:5199/tour/minneapolis/', 'page').searchParams.has('scene')).toBe(false);
  });
});
