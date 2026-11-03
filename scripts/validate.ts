import { buildIndex, checkRegistry, readEntries } from "../src/registry";

// bun run validate: every offer against the registry's rules, and index.json
// against the offers. bun run index (--write) writes index.json instead of
// comparing it.

const root = `${import.meta.dir}/..`;
const write = process.argv.includes("--write");
const { offers, problems } = checkRegistry(await readEntries(root));
for (const problem of problems)
  console.error(`${problem.file}: ${problem.message}`);
if (problems.length > 0) process.exit(1);

const index = buildIndex(offers);
const path = `${root}/index.json`;
const file = Bun.file(path);
if (write) {
  await Bun.write(path, index);
  console.log(`index.json: ${offers.length} offers`);
} else if (!(await file.exists()) || (await file.text()) !== index) {
  console.error("index.json is not current: run bun run index");
  process.exit(1);
} else console.log(`${offers.length} offers valid, index.json current`);
