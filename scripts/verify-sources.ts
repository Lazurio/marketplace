import { checkRegistry, readEntries } from "../src/registry";
import { gitHubApi, verifySources } from "../src/sources";

// bun run verify:sources: every offer's repository and offered release on
// GitHub (CI runs it with the workflow's token; GITHUB_TOKEN is optional
// locally, only the rate limit is lower without it).

const root = `${import.meta.dir}/..`;
const { offers, problems } = checkRegistry(await readEntries(root));
if (problems.length > 0) {
  console.error("offers are not valid: run bun run validate");
  process.exit(1);
}
const github = gitHubApi(process.env.GITHUB_TOKEN || undefined);
let failed = false;
for (const offer of offers) {
  const report = await verifySources(offer, github);
  for (const note of report.notes) console.log(`${report.offer}: ${note}`);
  for (const problem of report.problems)
    console.error(`${report.offer}: ${problem}`);
  if (report.problems.length > 0) failed = true;
  else console.log(`${report.offer}: ok`);
}
if (failed) process.exit(1);
