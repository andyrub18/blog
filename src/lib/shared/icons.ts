/**
 * The icons any page may draw: the header's, and the reading view's. SVG path
 * data on a 24 × 24 grid, drawn with a 2 px stroke; shapes adapted from Lucide
 * (lucide.dev, ISC licence).
 *
 * Two files, by who pays for them. These are the header's, and in the browser
 * only the header imports them, so they travel inside the header's own chunk —
 * which every page loads anyway — rather than in a file of their own. The
 * editor's toolbar, the file picker and the review areas draw from
 * `icons-workspace.ts`, which only those pages load. One file held both, and
 * the bundler, keeping every shape any importer used, put all of them on the
 * article page: 1.5 KB, mostly toolbar, on the page the budget is written for.
 * The server-written pages may use either; that costs no JavaScript.
 *
 * An icon never carries meaning alone. It sits beside a word, or on a button
 * whose `aria-label` names it; the SVG itself is always `aria-hidden`.
 */

export const ICON_PEN =
  'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z'
export const ICON_HOME = 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10'
export const ICON_SIGN_IN =
  'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3'
export const ICON_SIGN_OUT =
  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'
export const ICON_BOOK =
  'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'
export const ICON_APPLICATIONS =
  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
export const ICON_APPLY =
  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M19 8v6M22 11h-6'
