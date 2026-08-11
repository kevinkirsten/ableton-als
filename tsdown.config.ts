import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/web.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // No assumptions about the host: the core must run in Node, Deno, Bun,
  // Workers and the browser alike.
  platform: "neutral",
  target: "es2022",
})
