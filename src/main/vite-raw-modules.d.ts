// Vite `?raw` imports are used in the main process to inline the Sylva scene's
// bundled HTML and Three.js runtime as plain strings. The renderer gets these
// ambient module declarations from `vite/client` (see src/renderer/src/env.d.ts),
// but the node tsconfig does not reference vite/client, so declare the modules
// here. Keep it scoped to the suffix imports actually used.
declare module '*?raw' {
  const source: string
  export default source
}
