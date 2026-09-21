import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PLATFORM_SIDE_SHEET_SIZES,
  PLATFORM_SURFACE_LAYERS,
  resolvePlatformSideSheetSide,
} from './platformSideSheetContract.js';

const component = readFileSync(new URL('./PlatformSideSheet.jsx', import.meta.url), 'utf8');
const platformIndex = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8');

test('semantic sizes map to centrally owned responsive widths', () => {
  assert.deepEqual(Object.keys(PLATFORM_SIDE_SHEET_SIZES), ['sm', 'md', 'lg', 'xl']);
  assert.deepEqual(Object.values(PLATFORM_SIDE_SHEET_SIZES), [
    'sm:max-w-[24rem]',
    'sm:max-w-[32rem]',
    'sm:max-w-[42rem]',
    'sm:max-w-[52rem]',
  ]);
});

test('logical placement resolves for LTR and RTL', () => {
  assert.equal(resolvePlatformSideSheetSide('start', 'ltr'), 'left');
  assert.equal(resolvePlatformSideSheetSide('end', 'ltr'), 'right');
  assert.equal(resolvePlatformSideSheetSide('start', 'rtl'), 'right');
  assert.equal(resolvePlatformSideSheetSide('end', 'rtl'), 'left');
});

test('surface owns its layers and reserves higher nested overlay layers', () => {
  assert.deepEqual(PLATFORM_SURFACE_LAYERS, {
    sideSheetOverlay: 'platform-side-sheet-overlay',
    sideSheet: 'platform-side-sheet-content',
    nestedOverlay: 'z-[60]',
    nestedContent: 'z-[70]',
  });
  assert.match(styles, /\.platform-side-sheet-overlay,\s*\.platform-side-sheet-content\s*\{\s*z-index:\s*40;/);
});

test('component keeps Radix mechanics in the core Sheet primitive', () => {
  assert.match(component, /from ['"]@\/core\/ui\/sheet['"]/);
  assert.doesNotMatch(component, /@radix-ui|createPortal|framer-motion|@\/features\//);
  assert.match(component, /<Sheet open=\{open\} onOpenChange=\{onOpenChange\}>/);
});

test('title, accessible close, optional description and footer are composed', () => {
  assert.match(component, /requires a title for accessible dialog semantics/);
  assert.match(component, /<SheetTitle[^>]*>\{title\}<\/SheetTitle>/);
  assert.match(component, /aria-label=\{resolvedCloseLabel\}/);
  assert.match(component, /description \? \([\s\S]*<SheetDescription[^>]*>/);
  assert.match(component, /\{headerNotice\}/);
  assert.match(component, /\{headerActions\}/);
  assert.match(component, /footer \? \(/);
});

test('header notice shares the title row instead of creating another row', () => {
  assert.match(component, /<div className="flex min-w-0 items-center gap-2">[\s\S]*<SheetTitle[\s\S]*\{headerNotice\}[\s\S]*<\/div>/);
  assert.doesNotMatch(component, /<\/SheetDescription>\s*\) : null\}\s*\{headerNotice\}/);
});

test('loading, dismiss and mobile contracts are present', () => {
  assert.match(component, /loadingContent \?\? <PlatformSideSheetLoading/);
  assert.match(component, /onEscapeKeyDown=\{preventDismiss\}/);
  assert.match(component, /onPointerDownOutside=\{preventDismiss\}/);
  assert.match(component, /h-\[100dvh\] max-h-\[100dvh\] w-full/);
  assert.match(component, /env\(safe-area-inset-top\)/);
  assert.match(component, /env\(safe-area-inset-bottom\)/);
});

test('compact density reduces shell chrome without changing the default density', () => {
  assert.match(component, /density = 'comfortable'/);
  assert.match(component, /const compact = density === 'compact'/);
  assert.match(component, /data-density=\{compact \? 'compact' : 'comfortable'\}/);
  assert.match(component, /compact \? 'text-base leading-6' : undefined/);
  assert.match(component, /compact \? 'px-3 py-3 sm:px-4' : 'px-5 py-5 sm:px-6'/);
  assert.match(component, /bodyClassName/);
});

test('platform exports the public surface and reduced motion is supported', () => {
  assert.match(platformIndex, /export \{ PlatformSideSheet \} from ['"]\.\/surfaces\/PlatformSideSheet['"]/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.sheet-overlay/);
  assert.match(styles, /\.sheet-content/);
});

test('platform side-sheet motion uses a small edge offset without backdrop blur', () => {
  assert.match(styles, /platform-sheet-right-in 140ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(styles, /platform-sheet-right-out 110ms ease-in/);
  assert.match(styles, /platform-sheet-left-in 140ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(styles, /platform-sheet-left-out 110ms ease-in/);
  for (const offset of ['20px', '-20px']) assert.match(styles, new RegExp(`translate3d\\(${offset}`));
  assert.match(styles, /\.platform-side-sheet-overlay\s*\{[\s\S]*?backdrop-filter: none;/);
  assert.match(styles, /\.platform-side-sheet-content\.sheet-content-right\[data-state\][\s\S]*?animation-duration: 1ms/);
});
