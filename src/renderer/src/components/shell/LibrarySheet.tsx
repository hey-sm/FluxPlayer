export function LibrarySheet({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flux-library-sheet flux-hover-panel is-open"><div className="flux-sheet-body">{children}</div></div>
}
