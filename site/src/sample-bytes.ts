// The sample set's bytes, bundled into the page.
//
// The page may not fetch anything (`connect-src 'none'`), so the file travels
// inside the script as base64 and is turned back into bytes here. `atob`
// returns one character per byte, which is exactly right for binary data like
// this gzip stream; it would be wrong for text, which this is not.

import sampleDataUrl from "../sample/Demo Set.als?inline"

export function sampleBytes(): Uint8Array {
  const base64 = sampleDataUrl.slice(sampleDataUrl.indexOf(",") + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
