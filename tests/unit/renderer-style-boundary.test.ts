import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectFile = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

function readRendererTree(extensions = new Set(['.css', '.ts', '.tsx'])): string {
  const root = fileURLToPath(new URL('../../src/renderer/src', import.meta.url))
  const sources: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (extensions.has(extname(entry.name))) sources.push(readFileSync(path, 'utf8'))
    }
  }
  visit(root)
  return sources.join('\n')
}

describe('renderer style migration boundary', () => {
  it('permanently rejects m3.css and its remaining legacy semantic classes', () => {
    const rendererSources = readRendererTree()
    const mainSource = projectFile('src/renderer/src/main.tsx')

    expect(existsSync(new URL('../../src/renderer/src/styles/m3.css', import.meta.url))).toBe(false)
    expect(existsSync(new URL('../../tests/fixtures/renderer-m3-selectors.json', import.meta.url))).toBe(
      false,
    )
    expect(mainSource).not.toContain('./styles/m3.css')

    for (const legacyClass of [
      'content-tabs',
      'm3-workspace',
      'browser-pane',
      'lyrics-panel',
      'lyrics-line-text',
      'diy-settings-backdrop',
      'diy-panel-shell',
      'diy-panel',
      'diy-grid',
      'settings-close',
      'theme-range',
      'stage-bg',
    ]) {
      expect(rendererSources).not.toContain(legacyClass)
    }
  })

  it('keeps migrated edge sheets out of the frozen legacy stylesheet', () => {
    const migratedSources = [
      projectFile('src/renderer/src/components/shell/HoverEdgeSheet.tsx'),
      projectFile('src/renderer/src/components/shell/LibrarySheet.tsx'),
      projectFile('src/renderer/src/components/shell/PlaylistDetailSheet.tsx'),
    ].join('\n')

    for (const legacyClass of [
      'flux-hover-panel',
      'flux-library-sheet',
      'flux-detail-sheet',
      'classic-panel-glass',
      'flux-library-sensor',
      'flux-detail-sensor',
    ]) {
      expect(migratedSources).not.toContain(legacyClass)
    }

    const legacyStyles = [readRendererTree(new Set(['.css']))].join('\n')
    for (const legacySelector of [
      '.search-hover-sensor',
      '.search-shell',
      '.search-animated-content',
      '.search-popover',
      '.search-provider-tabs',
      '.search-results',
      '.result-row',
    ]) {
      expect(legacyStyles).not.toContain(legacySelector)
    }

    const searchSource = projectFile('src/renderer/src/features/search/SearchPanel.tsx')
    expect(searchSource).toContain('data-search-shell=""')
    expect(searchSource).toContain('data-search-sensor=""')
    expect(searchSource).toContain('data-search-motion=""')
  })

  it('keeps migrated library lists on Tailwind and GSAP without Motion or legacy CSS', () => {
    const animatedListSource = projectFile('src/renderer/src/components/react-bits/AnimatedList.tsx')
    const librarySource = projectFile('src/renderer/src/features/library/LibraryWorkspace.tsx')
    const legacyStyles = [readRendererTree(new Set(['.css']))].join('\\n')

    for (const legacySelector of [
      '.library-drawer',
      '.library-provider-tabs',
      '.library-shortcuts',
      '.library-playlist-list',
      '.library-shelf-sync',
      '.shelf-detail-',
      '.playlist-rail',
      '.rotating-cover',
      '.animated-list-',
    ]) {
      expect(legacyStyles).not.toContain(legacySelector)
    }

    expect(animatedListSource).toContain('useGSAP(')
    expect(animatedListSource).toContain('data-animated-list-item=""')
    expect(animatedListSource).not.toContain("from 'motion/react'")
    // Rows keep the upstream `whileInView` contract: they scale in and back out on every crossing, so
    // the observer must stay repeating rather than degrading to a one-shot mount animation.
    expect(animatedListSource).toContain('new IntersectionObserver(')
    expect(animatedListSource).toContain('scale: inView ? 1 : ROW_HIDDEN_SCALE')
    expect(animatedListSource).not.toContain('revertOnUpdate')
    expect(librarySource).toContain('data-library-panel=""')
    expect(librarySource).toContain('data-library-detail-panel=""')
    expect(
      existsSync(new URL('../../src/renderer/src/components/react-bits/react-bits.css', import.meta.url)),
    ).toBe(false)

    const packageJson = JSON.parse(projectFile('package.json')) as { dependencies: Record<string, string> }
    expect(packageJson.dependencies.motion).toBeUndefined()
  })

  it('keeps settings, glass select, and maintenance UI out of legacy CSS', () => {
    const settingsSource = projectFile('src/renderer/src/features/settings/SettingsPanel.tsx')
    const colorPickerSource = projectFile('src/renderer/src/components/ui/color-picker.tsx')
    const selectSource = projectFile('src/renderer/src/components/ui/glass-select.tsx')
    const maintenanceSource = projectFile('src/renderer/src/features/system/SystemMaintenancePanel.tsx')
    const legacyCss = readRendererTree(new Set(['.css']))

    for (const legacySelector of [
      '.settings-tabs',
      '.theme-panel',
      '.theme-field',
      '.color-picker',
      '.settings-switch',
      '.custom-background-',
      '.wallpaper-project-',
      '.glass-select-',
      '.quality-trigger',
      '.system-maintenance-',
    ]) {
      expect(legacyCss).not.toContain(legacySelector)
    }

    expect(settingsSource).toContain('settingsSwitchVariants = cva(')
    expect(settingsSource).toContain('data-settings-panel=""')
    expect(settingsSource).toContain('role="switch"')
    expect(colorPickerSource).toContain('data-color-picker=""')
    expect(selectSource).toContain('glassSelectTriggerVariants = cva(')
    expect(selectSource).toContain('useGSAP(')
    expect(selectSource).toContain('onComplete: () => setContentMounted(false)')
    expect(selectSource).toContain('reducedMotion ? 0 : motionDurations.base')
    expect(maintenanceSource).toContain('scaleX: percent / 100')
    expect(maintenanceSource).toContain("overwrite: 'auto'")
    expect(maintenanceSource).not.toContain('style={{ width:')
    expect(
      existsSync(
        new URL('../../src/renderer/src/features/system/SystemMaintenancePanel.css', import.meta.url),
      ),
    ).toBe(false)
  })

  it('uses scoped GSAP presence for Radix dialog and sheet lifecycle', () => {
    const dialogSource = projectFile('src/renderer/src/components/ui/dialog.tsx')
    const sheetSource = projectFile('src/renderer/src/components/ui/sheet.tsx')
    const settingsSource = projectFile('src/renderer/src/features/settings/SettingsPanel.tsx')
    const appSource = projectFile('src/renderer/src/App.tsx')
    const shadcnCss = projectFile('src/renderer/src/styles/shadcn.css')
    const packageJson = JSON.parse(projectFile('package.json')) as {
      devDependencies: Record<string, string>
    }

    for (const source of [dialogSource, sheetSource]) {
      expect(source).toContain('useGSAP(')
      expect(source).toContain('gsap.timeline()')
      expect(source).toContain("overwrite: 'auto'")
      expect(source).toContain(".eventCallback('onComplete'")
      expect(source).toContain('completeExit()')
      expect(source).toContain('forceMount')
      expect(source).toContain('reducedMotion ? 0 : motionDurations.base')
      expect(source).not.toContain('animate-in')
      expect(source).not.toContain('animate-out')
    }

    expect(dialogSource).toContain('data-dialog-motion-overlay=""')
    expect(dialogSource).toContain('data-dialog-motion-content=""')
    expect(dialogSource).toContain('-translate-x-1/2 -translate-y-1/2')
    expect(sheetSource).toContain('data-sheet-motion-overlay=""')
    expect(sheetSource).toContain('data-sheet-motion-content=""')
    expect(appSource).toContain('settingsMounted ? (')
    expect(appSource).toContain('open={settingsOpen}')
    expect(settingsSource).not.toContain('if (!open) return null')
    expect(shadcnCss).not.toContain('tw-animate-css')
    expect(packageJson.devDependencies['tw-animate-css']).toBeUndefined()
  })

  it('keeps repeated renderer controls on shared semantic CVA variants', () => {
    const buttonSource = projectFile('src/renderer/src/components/ui/button.tsx')
    const buttonVariantsSource = projectFile('src/renderer/src/components/ui/button-variants.ts')
    const dialogSource = projectFile('src/renderer/src/components/ui/dialog.tsx')
    const sheetSource = projectFile('src/renderer/src/components/ui/sheet.tsx')
    const settingsSource = projectFile('src/renderer/src/features/settings/SettingsPanel.tsx')
    const maintenanceSource = projectFile('src/renderer/src/features/system/SystemMaintenancePanel.tsx')
    const librarySource = projectFile('src/renderer/src/features/library/LibraryWorkspace.tsx')
    const libraryVariants = projectFile('src/renderer/src/features/library/variants.ts')

    expect(buttonSource).toContain("import { buttonVariants } from './button-variants'")
    expect(buttonVariantsSource).toContain('glassSoft: [')
    expect(buttonVariantsSource).toContain('glassRaised: [')
    expect(buttonVariantsSource).toContain('emphasis: {')
    expect(dialogSource).toContain("buttonVariants({ variant: 'ghost', size: 'icon-sm' })")
    expect(sheetSource).toContain("buttonVariants({ variant: 'ghost', size: 'icon-sm' })")
    expect(settingsSource).toContain('variant="glassSoft"')
    expect(settingsSource).not.toContain('backgroundButtonVariants')
    expect(maintenanceSource).toContain('variant="glassRaised"')
    expect(maintenanceSource).not.toContain('maintenanceButtonVariants')
    expect(librarySource).toContain("libraryRowVariants({ layout: 'detail' })")
    expect(librarySource).toContain("libraryRowVariants({ layout: 'playlist' })")
    expect(libraryVariants).toContain('export const libraryStatusVariants = cva(')
  })

  it('keeps the restored player width, borderless list rows, and renderer preferences explicit', () => {
    const playerSource = projectFile('src/renderer/src/components/player/PlayerBar.tsx')
    const libraryVariants = projectFile('src/renderer/src/features/library/variants.ts')
    const settingsSource = projectFile('src/renderer/src/features/settings/SettingsPanel.tsx')
    const stageCanvasSource = projectFile('src/renderer/src/visual/StageCanvas.tsx')
    const appSource = projectFile('src/renderer/src/App.tsx')

    expect(playerSource).toContain('max-w-[860px]')
    expect(libraryVariants).not.toContain('border border-transparent')
    expect(libraryVariants).not.toContain('data-[selected=true]:border-')
    expect(libraryVariants).not.toContain('data-[focused=true]:border-')
    expect(settingsSource).toContain('ariaLabel="歌词动画"')
    expect(settingsSource).toContain("backgroundMode === 'wallpaper'")
    expect(stageCanvasSource).toContain('data-lyrics-animation-mode={lyricsAnimationMode}')
    expect(appSource).toContain("setBackgroundMode('dynamic')")
    expect(appSource).toContain("setBackgroundMode(result.background ? 'wallpaper' : 'dynamic')")
  })

  it('does not let an unlayered universal reset override Tailwind utilities', () => {
    const globalCss = projectFile('src/renderer/src/styles/global.css')
    expect(globalCss).not.toMatch(/\*\s*\{[^}]*(?:margin|padding)\s*:/s)
  })

  it('keeps global.css limited to document, selection, drag, and scroll behavior', () => {
    const globalCss = projectFile('src/renderer/src/styles/global.css')
    const accountSource = projectFile('src/renderer/src/features/account/AccountArea.tsx')

    for (const businessSelector of [
      '.account',
      '.avatar',
      '.nick',
      '.vip',
      '.warn',
      '.hint',
      '.login',
      '.logout',
      '.footer',
      '.playerbar',
      '.music-shelf',
      '.stage-bg',
    ]) {
      expect(globalCss).not.toContain(businessSelector)
    }

    expect(accountSource).toContain('data-account-area=""')
    expect(accountSource).toContain('data-account-nickname=""')
    expect(accountSource).toContain('accountBadgeVariants = cva(')
    expect(accountSource).toContain('variant="glassSoft"')
  })

  it('uses tokens.css as the source for renderer motion, radii, shadows, and glass values', () => {
    const tokens = projectFile('src/renderer/src/theme/tokens.css')
    const shadcn = projectFile('src/renderer/src/styles/shadcn.css')
    const global = projectFile('src/renderer/src/styles/global.css')
    const effects = projectFile('src/renderer/src/styles/effects.css')
    const motion = projectFile('src/renderer/src/motion/preferences.ts')
    const rendererSources = [
      projectFile('src/renderer/src/components/player/PlayerBar.tsx'),
      projectFile('src/renderer/src/components/glass/surface.tsx'),
      projectFile('src/renderer/src/features/search/SearchPanel.tsx'),
      projectFile('src/renderer/src/features/settings/SettingsPanel.tsx'),
      projectFile('src/renderer/src/features/library/variants.ts'),
    ].join('\n')

    for (const token of [
      '--flux-radius-control',
      '--flux-radius-panel',
      '--flux-radius-shell',
      '--flux-edge-sheet-radius',
      '--flux-shadow-control',
      '--flux-shadow-panel',
      '--motion-duration-fast',
      '--motion-duration-base',
      '--saved-panel-glass-filter',
    ]) {
      expect(tokens).toContain(token)
    }
    expect(shadcn).toContain('--radius-control: var(--flux-radius-control)')
    expect(shadcn).toContain('--shadow-control: var(--flux-shadow-control)')
    expect(global).not.toContain('--saved-panel-glass-filter:')
    expect(effects).toContain('border-radius: var(--flux-search-glass-radius)')
    expect(motion).toContain("durationFromToken('--motion-duration-fast', 0.14)")
    expect(rendererSources).not.toMatch(/duration-(?:150|\[(?:130|160)ms\])/)

    for (const compatibilityAlias of [
      '--bg:',
      '--panel:',
      '--panel-border:',
      '--text:',
      '--text-dim:',
      '--accent:',
      '--danger:',
      '--topbar-height:',
    ]) {
      expect(tokens).not.toContain(compatibilityAlias)
    }
  })

  it('locks edge glass to reusable variants and a 15px inner radius', () => {
    const surfaceSource = projectFile('src/renderer/src/components/glass/surface.tsx')
    const sheetSource = projectFile('src/renderer/src/components/shell/HoverEdgeSheet.tsx')

    expect(surfaceSource).toContain('classicPanel: [')
    expect(surfaceSource).toContain("left: 'rounded-l-none rounded-r-[15px]'")
    expect(surfaceSource).toContain("right: 'rounded-r-none rounded-l-[15px]'")
    expect(sheetSource).toContain("glassSurfaceVariants({ treatment: 'classicPanel', edge: side })")
    expect(sheetSource).toContain('data-edge-sheet=""')
    expect(sheetSource).toContain('data-edge-sheet-sensor=""')
    expect(sheetSource).toContain('[@media(max-height:560px)]:bottom-[88px]')
  })

  it('loads complex effects separately and keeps preview distinct from HMR development', () => {
    const mainSource = projectFile('src/renderer/src/main.tsx')
    const packageJson = JSON.parse(projectFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(mainSource).toContain("import './styles/effects.css'")
    expect(mainSource.indexOf("import './styles/shadcn.css'")).toBeLessThan(
      mainSource.indexOf("import './theme/tokens.css'"),
    )
    expect(mainSource.indexOf("import './theme/tokens.css'")).toBeLessThan(
      mainSource.indexOf("import './styles/global.css'"),
    )
    expect(mainSource.indexOf("import './styles/global.css'")).toBeLessThan(
      mainSource.indexOf("import './styles/effects.css'"),
    )
    expect(packageJson.scripts.start).toBe('pnpm dev')
    expect(packageJson.scripts.preview).toBe('electron-vite preview')
  })
})
