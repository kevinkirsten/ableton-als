import { readFile } from "node:fs/promises"
import {
  decodeAls,
  validateGeneratedSet,
} from "ableton-als/node"

const xml = decodeAls(await readFile("Song.als"))

for (const problem of validateGeneratedSet(xml)) {
  // `code` and `values` are stable, made for your own
  // wording or language. `detail` is English prose.
  console.log(problem.rule, problem.code, problem.values)
  console.log(problem.detail)
}
