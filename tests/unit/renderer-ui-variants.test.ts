import { describe, expect, it } from 'vitest'
import { buttonVariants } from '../../src/renderer/src/components/ui/button-variants'
import { libraryRowVariants, libraryStatusVariants } from '../../src/renderer/src/features/library/variants'
import { cn } from '../../src/renderer/src/lib/utils'

describe('renderer shared CVA variants', () => {
  it('builds semantic glass button treatments and primary emphasis', () => {
    const soft = buttonVariants({ variant: 'glassSoft', size: 'compact' })
    const raised = buttonVariants({ variant: 'glassRaised', size: 'action' })
    const primary = buttonVariants({ variant: 'glassRaised', size: 'action', emphasis: 'primary' })

    expect(soft).toContain('border-[var(--flux-glass-border)]')
    expect(soft).toContain('min-h-[30px]')
    expect(raised).toContain('min-h-[2.1rem]')
    expect(raised).not.toContain('var(--flux-accent)_26%')
    expect(primary).toContain('var(--flux-accent)_26%')
  })

  it('lets caller classes override shared size and radius utilities through cn', () => {
    const merged = cn(buttonVariants({ variant: 'glassSoft', size: 'compact' }), 'min-h-10 rounded-xl')

    expect(merged).toContain('min-h-10')
    expect(merged).toContain('rounded-xl')
    expect(merged).not.toContain('min-h-[30px]')
    expect(merged).not.toContain('rounded-[9px]')
  })

  it('keeps playlist and detail rows on one shared state model', () => {
    const playlist = libraryRowVariants({ layout: 'playlist' })
    const detail = libraryRowVariants({ layout: 'detail' })

    for (const value of [playlist, detail]) {
      expect(value).toContain('data-[selected=true]:bg-[var(--flux-accent-soft)]')
      expect(value).toContain('data-[focused=true]:bg-')
      expect(value).not.toContain('data-[focused=true]:border-')
      expect(value).not.toContain('border-transparent')
    }
    expect(playlist).toContain('grid-cols-[44px_minmax(0,1fr)]')
    expect(detail).toContain('grid-cols-[42px_minmax(0,1fr)]')
  })

  it('uses semantic status tones without conflicting text utilities', () => {
    expect(libraryStatusVariants()).toContain('text-[var(--flux-text-muted)]')
    expect(libraryStatusVariants({ tone: 'danger' })).toContain('text-[var(--flux-danger)]')
    expect(libraryStatusVariants({ tone: 'danger' })).not.toContain('text-[var(--flux-text-muted)]')
  })
})
