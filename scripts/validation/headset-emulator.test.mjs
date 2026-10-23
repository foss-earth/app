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
    expect(Object.fromEntries(url.searchParams)).toEqual({
      renderer: 'auto', headsetEmulator: 'quest2', panoramaTest: '1', scene: SCENE, 'set.interface.windows.tabPicker': 'dropdown',
    });
    expect(pageUrl('http://127.0.0.1:5173/app/', 'page', 'visionpro').searchParams.get('headsetEmulator')).toBe('visionpro');
  });

  it('keeps a page\'s own scene when asked to', () => {
    expect(parseOptions(['--binary=/chrome'], {}, () => false).device).toBe('quest2');
    expect(parseOptions(['--binary=/chrome'], {}, () => false).comprehensive).toBe(false);
    expect(parseOptions(['--binary=/chrome', '--device=quest3'], {}, () => false).device).toBe('quest3');
    expect(parseOptions(['--binary=/chrome', '--comprehensive'], {}, () => false).comprehensive).toBe(true);
    expect(() => parseOptions(['--binary=/chrome', '--device=quest1'], {}, () => false)).toThrow(/quest2, quest3, questPro, visionpro/);
    expect(() => parseOptions(['--binary=/chrome', '--comprehensive', '--device=quest2'], {}, () => false)).toThrow(/together/);
    expect(parseOptions(['--binary=/chrome'], {}, () => false).scene).toBe(SCENE);
    expect(parseOptions(['--binary=/chrome', '--scene=page'], {}, () => false).scene).toBe('page');
    expect(pageUrl('http://localhost:5199/tour/minneapolis/', 'page').searchParams.has('scene')).toBe(false);
  });
});
