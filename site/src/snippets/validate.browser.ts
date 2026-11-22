import {
  decodeAls,
  validateGeneratedSet,
} from "ableton-als/web"

export async function validate(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  for (const problem of validateGeneratedSet(xml)) {
    // `code` and `values` are stable, made for your own
    // wording or language. `detail` is English prose.
    console.log(problem.rule, problem.code)
    console.log(problem.values)
    console.log(problem.detail)
  }
}
