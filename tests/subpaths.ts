/**
 * GitHub Pages serves a project site from a folder named after the repository,
 * so the build must not care what that folder is called. Both the Playwright
 * config (which starts one static server per case) and the spec (which runs the
 * whole suite against each case) read this list, so adding a name here adds a
 * full run for it.
 */
export type SubpathCase = {
  /** Folder name as it appears in the URL: https://user.github.io/<name>/ */
  name: string
  port: number
}

export const SUBPATH_CASES: SubpathCase[] = [
  { name: 'repo', port: 4181 },
  // A different repo name proves the build is subpath-agnostic, not tuned to /repo/.
  { name: 'chat-app', port: 4182 },
]
