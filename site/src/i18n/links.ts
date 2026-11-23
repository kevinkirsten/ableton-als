// Where a link in catalog text leads. The catalogs name a target, as in
// `[link text](issues)`, and never hold a URL, so a translation cannot change
// where a link goes. A test checks every target a catalog uses is listed here.

export const LINKS: Readonly<Record<string, string>> = {
  verify: "#verify",
  repo: "https://github.com/kevinkirsten/ableton-als",
  issues: "https://github.com/kevinkirsten/ableton-als/issues",
}

/** Finds `[link text](target)` in RICH catalog text. */
export const LINK_PATTERN = /\[([^\]]+)\]\(([a-z]+)\)/g
