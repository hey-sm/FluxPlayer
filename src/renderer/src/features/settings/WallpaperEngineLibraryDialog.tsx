import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  EyeOff,
  FilePlus2,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import type {
  WallpaperEngineLibrarySnapshot,
  WallpaperEngineProject,
  WallpaperEngineSelection,
  WallpaperEngineState,
} from '@shared/wallpaper-engine-contract'
import { GlassSurface } from '../../components/glass'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { cn } from '../../lib/utils'
import { showToast } from '../../stores/toast'

interface WallpaperPreviewProps {
  project: WallpaperEngineProject
}

function WallpaperPreview({ project }: WallpaperPreviewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [nearby, setNearby] = useState(!project.previewAnimated)
  useEffect(() => {
    const node = containerRef.current
    if (!node || !project.previewAnimated || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), {
      rootMargin: '220px 0px',
      threshold: 0.01,
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [project.previewAnimated])
  return (
    <div
      ref={containerRef}
      className="relative aspect-video overflow-hidden bg-[color-mix(in_srgb,var(--flux-panel-border)_8%,transparent)]"
    >
      {project.previewUrl && nearby ? (
        <img
          src={project.previewUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-opacity duration-200 motion-reduce:transition-none"
        />
      ) : (
        <div className="grid size-full place-items-center text-[var(--flux-text-muted)]">
          <span className="text-[10px]">暂无预览</span>
        </div>
      )}
      <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[9px] font-medium tracking-[0.04em] text-white backdrop-blur-sm">
        {project.enginePlayable ? (
          <Film size={10} aria-hidden="true" />
        ) : (
          <ImageIcon size={10} aria-hidden="true" />
        )}
        {project.enginePlayable ? 'LIVE SCENE' : project.mediaType === 'video' ? 'VIDEO' : 'IMAGE'}
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/50 to-transparent" />
    </div>
  )
}

function projectLabel(project: WallpaperEngineProject, nativeRuntimeAvailable: boolean): string {
  if (project.enginePlayable)
    return nativeRuntimeAvailable ? 'Scene · DWM 原生运行' : 'Scene · 原生运行不可用'
  if (project.playable && project.mediaType === 'video') return 'Video · 直接播放'
  if (project.playable && project.mediaType === 'image') return '图片 · 原图显示'
  if (project.projectType === 'web') return 'Web · 不支持播放'
  if (project.projectType === 'application') return 'Application · 不支持播放'
  return '项目 · 不支持播放'
}

function reportWallpaperError(reason: unknown, fallback: string): void {
  showToast(reason instanceof Error ? reason.message : fallback, {
    title: 'Wallpaper Engine 操作失败',
    tone: 'error',
    duration: 8000,
  })
}

export function WallpaperEngineLibraryDialog({
  selection,
  onSelectionChange,
  onSnapshotChange,
}: {
  selection: WallpaperEngineSelection
  onSelectionChange(state: WallpaperEngineState): void
  onSnapshotChange?(snapshot: WallpaperEngineLibrarySnapshot): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<WallpaperEngineLibrarySnapshot | null>(null)
  const [state, setState] = useState<WallpaperEngineState | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [renderLimit, setRenderLimit] = useState(240)
  const [pendingSelectionId, setPendingSelectionId] = useState('')
  const [filter, setFilter] = useState<'all' | 'dynamic' | 'favorites'>('all')
  const selectionRequestRef = useRef(0)
  const deferredQuery = useDeferredValue(query)

  const effectiveState = useMemo<WallpaperEngineState>(
    () =>
      state ?? {
        version: 1,
        selection,
        favorites: [],
        hidden: [],
      },
    [selection, state],
  )

  const commitSnapshot = useCallback(
    (next: WallpaperEngineLibrarySnapshot) => {
      setSnapshot(next)
      onSnapshotChange?.(next)
    },
    [onSnapshotChange],
  )

  const projects = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()
    return [...(snapshot?.projects ?? [])]
      .filter((project) => !effectiveState.hidden.includes(project.id))
      .filter((project) => {
        if (filter === 'favorites') return effectiveState.favorites.includes(project.id)
        if (filter === 'dynamic')
          return project.enginePlayable || project.mediaType === 'video' || project.previewAnimated
        return true
      })
      .filter((project) => {
        if (!normalizedQuery) return true
        return `${project.title} ${project.projectType} ${project.sourceLabel} ${project.workshopId}`
          .toLowerCase()
          .includes(normalizedQuery)
      })
      .sort((a, b) => {
        const favoriteA = effectiveState.favorites.includes(a.id) ? 1 : 0
        const favoriteB = effectiveState.favorites.includes(b.id) ? 1 : 0
        return (
          favoriteB - favoriteA ||
          Number(b.playable) - Number(a.playable) ||
          a.title.localeCompare(b.title, 'zh-CN')
        )
      })
  }, [deferredQuery, effectiveState, filter, snapshot])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const desktop = window.fluxDesktop
    if (!desktop) {
      reportWallpaperError(null, '当前环境不支持 Wallpaper Engine 本地识别')
      return
    }
    if (snapshot) return
    setLoading(true)
    void desktop
      .listWallpaperEngineProjects(false)
      .then((result) => {
        if (cancelled) return
        commitSnapshot(result)
        setState(result.state)
      })
      .catch((reason: unknown) => {
        if (!cancelled) reportWallpaperError(reason, '扫描失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [commitSnapshot, open, snapshot])

  useEffect(() => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    return desktop.onWallpaperEngineStateChanged((next) => {
      setState(next)
      onSelectionChange(next)
    })
  }, [onSelectionChange])

  const applyState = async (
    next: Parameters<NonNullable<typeof window.fluxDesktop>['setWallpaperEngineState']>[0],
  ) => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setLoading(true)
    try {
      const nextState = await desktop.setWallpaperEngineState(next)
      setState(nextState)
      onSelectionChange(nextState)
    } catch (reason: unknown) {
      reportWallpaperError(reason, '状态更新失败')
    } finally {
      setLoading(false)
    }
  }

  const selectProject = async (project: WallpaperEngineProject) => {
    const desktop = window.fluxDesktop
    if (!desktop || pendingSelectionId) return
    if (!project.playable && !project.enginePlayable) return
    if (project.enginePlayable && snapshot?.runtime.available !== true) return
    if (effectiveState.selection.active && effectiveState.selection.id === project.id) return

    const requestId = ++selectionRequestRef.current
    const previousState = effectiveState
    const optimisticState: WallpaperEngineState = {
      ...effectiveState,
      selection: {
        version: effectiveState.selection.version,
        active: true,
        id: project.id,
        title: project.title,
        kind: project.enginePlayable ? 'engine' : 'media',
        mediaType: project.mediaType ?? 'image',
        projectType: project.projectType,
        updatedAt: project.updatedAt,
        runtimeError: '',
      },
    }

    setPendingSelectionId(project.id)
    setState(optimisticState)
    onSelectionChange(optimisticState)
    try {
      const nextState = await desktop.setWallpaperEngineState({ action: 'select', id: project.id })
      if (selectionRequestRef.current !== requestId) return
      setState(nextState)
      onSelectionChange(nextState)
    } catch (reason: unknown) {
      if (selectionRequestRef.current !== requestId) return
      setState(previousState)
      onSelectionChange(previousState)
      reportWallpaperError(reason, '背景应用失败')
    } finally {
      if (selectionRequestRef.current === requestId) setPendingSelectionId('')
    }
  }

  const refresh = async () => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setLoading(true)
    try {
      const result = await desktop.listWallpaperEngineProjects(true)
      commitSnapshot(result)
      setState(result.state)
      onSelectionChange(result.state)
      setRenderLimit(240)
    } catch (reason: unknown) {
      reportWallpaperError(reason, '扫描失败')
    } finally {
      setLoading(false)
    }
  }

  const chooseDirectory = async () => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setLoading(true)
    try {
      const result = await desktop.chooseWallpaperEngineDirectory()
      if (result.canceled) return
      if (!result.ok || !result.snapshot) throw new Error(result.error || '目录导入失败')
      commitSnapshot(result.snapshot)
      if (result.state) setState(result.state)
      setRenderLimit(240)
    } catch (reason: unknown) {
      reportWallpaperError(reason, '目录导入失败')
    } finally {
      setLoading(false)
    }
  }

  const chooseProjectFile = async () => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setLoading(true)
    try {
      const result = await desktop.chooseWallpaperEngineProjectFile()
      if (result.canceled) return
      if (!result.ok || !result.snapshot) throw new Error(result.error || '项目导入失败')
      commitSnapshot(result.snapshot)
      if (result.state) setState(result.state)
      setRenderLimit(240)
    } catch (reason: unknown) {
      reportWallpaperError(reason, '项目导入失败')
    } finally {
      setLoading(false)
    }
  }

  const removeDirectory = async (id: string) => {
    const desktop = window.fluxDesktop
    if (!desktop) return
    setLoading(true)
    try {
      const result = await desktop.removeWallpaperEngineDirectory(id)
      if (!result.ok || !result.snapshot) throw new Error(result.error || '移除目录失败')
      commitSnapshot(result.snapshot)
      if (result.state) {
        setState(result.state)
        onSelectionChange(result.state)
      }
    } catch (reason: unknown) {
      reportWallpaperError(reason, '移除目录失败')
    } finally {
      setLoading(false)
    }
  }

  const close = () => {
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="glassSoft"
        size="compact"
        onClick={() => setOpen(true)}
        aria-label="打开 Wallpaper Engine 项目库"
      >
        识别 / 导入
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          className="h-[min(820px,calc(100dvh-24px))] w-[min(1240px,calc(100vw-24px))] max-w-none gap-0 overflow-visible rounded-[22px] p-0"
          showCloseButton={false}
        >
          <GlassSurface
            elevation="raised"
            className="size-full min-h-0 overflow-hidden rounded-[22px]"
            contentClassName="flex size-full min-h-0 flex-col overflow-hidden"
            data-wallpaper-library-glass=""
          >
            <DialogHeader className="shrink-0 border-b border-[color-mix(in_srgb,var(--flux-glass-border)_80%,transparent)] px-6 pb-5 pt-6">
              <div className="flex items-start justify-between gap-5 pr-8">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[color-mix(in_srgb,var(--flux-accent)_35%,var(--flux-glass-border))] bg-[color-mix(in_srgb,var(--flux-accent)_14%,transparent)] text-[var(--flux-accent)]">
                      <Film size={17} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <DialogTitle className="truncate text-[18px] tracking-[0.01em]">
                        Wallpaper Engine 项目库
                      </DialogTitle>
                      <DialogDescription className="mt-1 max-w-[740px] text-[11px] leading-[1.5]">
                        在本机项目中选择背景。Video 直接播放，Scene 交给已验证的官方运行时实时渲染。
                      </DialogDescription>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-9 shrink-0 rounded-xl"
                  onClick={close}
                  aria-label="关闭项目库"
                >
                  <X size={17} />
                </Button>
              </div>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6 pt-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="relative min-w-[240px] flex-1">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--flux-text-muted)]"
                  />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索壁纸名称、类型或来源"
                    aria-label="搜索 Wallpaper Engine 项目"
                    className="h-10 w-full rounded-xl border border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_70%,transparent)] pl-9 pr-3 text-xs text-[var(--flux-text)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--flux-text-muted)] focus:border-[color-mix(in_srgb,var(--flux-accent)_65%,var(--flux-glass-border))] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--flux-accent)_12%,transparent)]"
                  />
                </label>
                <Button
                  type="button"
                  variant="glassSoft"
                  size="compact"
                  className="h-10 rounded-xl"
                  disabled={loading}
                  onClick={() => void chooseProjectFile()}
                >
                  <FilePlus2 size={14} /> 导入项目
                </Button>
                <Button
                  type="button"
                  variant="glassSoft"
                  size="compact"
                  className="h-10 rounded-xl"
                  disabled={loading}
                  onClick={() => void chooseDirectory()}
                >
                  <FolderOpen size={14} /> 导入目录
                </Button>
                <Button
                  type="button"
                  variant="glassSoft"
                  size="compact"
                  className="h-10 rounded-xl"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  {loading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}{' '}
                  刷新
                </Button>
                <Button
                  type="button"
                  variant="glassSoft"
                  size="compact"
                  className="h-10 rounded-xl"
                  disabled={loading}
                  onClick={() => void applyState({ action: 'restore-hidden' })}
                >
                  <EyeOff size={14} /> 恢复隐藏
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5" role="group" aria-label="项目筛选">
                  {(
                    [
                      ['all', '全部'],
                      ['dynamic', '动态'],
                      ['favorites', '收藏'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={cn(
                        'min-h-8 rounded-lg border px-3 text-[10px] font-medium transition-[background-color,border-color,color] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--flux-accent)] motion-reduce:transition-none',
                        filter === value
                          ? 'border-[color-mix(in_srgb,var(--flux-accent)_42%,var(--flux-glass-border))] bg-[color-mix(in_srgb,var(--flux-accent)_15%,transparent)] text-[var(--flux-text)]'
                          : 'border-transparent text-[var(--flux-text-muted)] hover:border-[var(--flux-glass-border)] hover:bg-[color-mix(in_srgb,var(--flux-panel-surface)_40%,transparent)] hover:text-[var(--flux-text)]',
                      )}
                      aria-pressed={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div
                  className="flex flex-wrap items-center justify-end gap-2 text-[10px] text-[var(--flux-text-muted)]"
                  aria-live="polite"
                >
                  <span className="rounded-full border border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_40%,transparent)] px-2.5 py-1">
                    {loading ? '正在扫描…' : snapshot ? `已识别 ${snapshot.count} 个项目` : '等待扫描'}
                  </span>
                  {snapshot ? (
                    <span className="rounded-full border border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_40%,transparent)] px-2.5 py-1">
                      {snapshot.dynamicCount} 个动态项目
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1',
                      snapshot?.runtime.available
                        ? 'border-[color-mix(in_srgb,var(--flux-accent)_32%,var(--flux-glass-border))] text-[var(--flux-accent)]'
                        : 'border-[var(--flux-glass-border)] text-[var(--flux-text-muted)]',
                    )}
                  >
                    {snapshot?.runtime.available ? 'Scene DWM 运行时已检测' : 'Scene 原生运行不可用'}
                  </span>
                </div>
              </div>
              {effectiveState.selection.active ? (
                <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--flux-accent)_28%,var(--flux-glass-border))] bg-[color-mix(in_srgb,var(--flux-accent)_8%,transparent)] px-3 py-2 text-[10px] text-[var(--flux-text-muted)]">
                  <span
                    className="size-1.5 rounded-full bg-[var(--flux-accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--flux-accent)_13%,transparent)]"
                    aria-hidden="true"
                  />
                  {pendingSelectionId ? '正在应用：' : '正在使用：'}
                  <strong className="truncate font-medium text-[var(--flux-text)]">
                    {effectiveState.selection.title || '已选择项目'}
                  </strong>
                </div>
              ) : null}
              {snapshot?.manualRoots.length ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--flux-text-muted)]">
                  <span className="mr-1">手动目录：</span>
                  {snapshot.manualRoots.map((root) => (
                    <span
                      key={root.id}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--flux-glass-border)] bg-[color-mix(in_srgb,var(--flux-panel-surface)_42%,transparent)] py-1 pl-2 pr-1"
                    >
                      <span className="max-w-44 overflow-hidden text-ellipsis whitespace-nowrap">
                        {root.name}
                      </span>
                      <button
                        type="button"
                        className="grid size-5 place-items-center rounded-full text-[var(--flux-text-muted)] hover:bg-[color-mix(in_srgb,var(--flux-danger)_15%,transparent)] hover:text-[var(--flux-danger)]"
                        aria-label={`移除目录 ${root.name}`}
                        onClick={() => void removeDirectory(root.id)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div
                className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-color:color-mix(in_srgb,var(--flux-accent)_35%,transparent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--flux-accent)_35%,transparent)]"
                data-scroll-region
              >
                {projects.length ? (
                  <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
                    {projects.slice(0, renderLimit).map((project) => {
                      const active =
                        effectiveState.selection.active && effectiveState.selection.id === project.id
                      const favorite = effectiveState.favorites.includes(project.id)
                      const pending = pendingSelectionId === project.id
                      const supported =
                        project.playable || (project.enginePlayable && snapshot?.runtime.available === true)
                      return (
                        <article
                          key={project.id}
                          className={cn(
                            'group relative overflow-hidden rounded-lg border bg-[color-mix(in_srgb,var(--flux-panel-surface)_48%,transparent)] transition-[border-color,transform,background-color] duration-200 motion-reduce:transition-none',
                            active
                              ? 'border-[color-mix(in_srgb,var(--flux-accent)_70%,var(--flux-glass-border))] bg-[color-mix(in_srgb,var(--flux-accent)_9%,var(--flux-panel-surface))]'
                              : 'border-[var(--flux-glass-border)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--flux-accent)_45%,var(--flux-glass-border))]',
                          )}
                        >
                          <button
                            type="button"
                            className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--flux-accent)] disabled:cursor-wait"
                            disabled={Boolean(pendingSelectionId) || active || !supported}
                            aria-busy={pending}
                            onClick={() => void selectProject(project)}
                          >
                            <WallpaperPreview project={project} />
                            <span className="block min-w-0 px-2.5 py-2">
                              <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium text-[var(--flux-text)]">
                                {project.title}
                              </strong>
                              <small className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[var(--flux-text-muted)]">
                                {projectLabel(project, snapshot?.runtime.available === true)}
                              </small>
                            </span>
                          </button>
                          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                            <Button
                              type="button"
                              variant="glassSoft"
                              size="icon-sm"
                              className="size-7 rounded-md"
                              aria-label={favorite ? '取消收藏' : '收藏项目'}
                              onClick={() =>
                                void applyState({ action: 'favorite', id: project.id, active: !favorite })
                              }
                            >
                              <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
                            </Button>
                            <Button
                              type="button"
                              variant="glassSoft"
                              size="icon-sm"
                              className="size-7 rounded-md"
                              aria-label="隐藏项目"
                              onClick={() => void applyState({ action: 'hide', id: project.id })}
                            >
                              <EyeOff size={13} />
                            </Button>
                          </div>
                          {pending ? (
                            <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/25 text-white backdrop-blur-[1px]">
                              <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />
                              <span className="sr-only">正在应用背景</span>
                            </span>
                          ) : null}
                          {active ? (
                            <span className="pointer-events-none absolute bottom-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-[var(--flux-accent)] text-[var(--flux-bg)]">
                              <Check size={12} strokeWidth={2.5} />
                            </span>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className="grid min-h-44 place-items-center rounded-lg border border-dashed border-[var(--flux-glass-border)] text-center text-[11px] leading-[1.5] text-[var(--flux-text-muted)]">
                    {loading
                      ? '正在识别本地项目…'
                      : snapshot?.projects.length
                        ? '没有符合搜索条件的项目'
                        : '没有识别到项目。可以导入目录或 project.json。'}
                  </div>
                )}
                {renderLimit < projects.length ? (
                  <Button
                    type="button"
                    variant="glassSoft"
                    size="compact"
                    className="mt-3 w-full"
                    onClick={() => setRenderLimit((value) => value + 240)}
                  >
                    继续加载 {Math.min(renderLimit, projects.length)} / {projects.length}
                  </Button>
                ) : null}
              </div>
            </div>
          </GlassSurface>
        </DialogContent>
      </Dialog>
    </>
  )
}
