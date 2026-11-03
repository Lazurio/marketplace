import { type Offer, offeredRelease } from "./registry";

// The registry's online rules: what the template's repository holds at the
// release an offer names. An offer whose releases have no commit yet is
// announced, and Lazurio does not show it: its repository may not exist or be
// public yet, and only a license GitHub already sees in a public one is
// checked; a license still missing there is a note.

/** One GET of the GitHub REST API, a path such as /repos/o/r, answering the
 * status and the body as bytes (the raw media type for contents). */
export type GitHub = (
  path: string,
) => Promise<Readonly<{ status: number; body: Uint8Array }>>;

export type SourceReport = Readonly<{
  offer: string;
  problems: string[];
  notes: string[];
}>;

/** Files the template contract requires in every release. */
export const requiredFiles = [
  "LICENSE",
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "docs/adoption.md",
  "docs/extending.md",
] as const;

const screenshotWidth = 1600;
const screenshotLimit = 2 * 1024 * 1024;

const json = (body: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(body));

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The width of a WebP image, or null when the bytes are not one. */
export function webpWidth(bytes: Uint8Array): number | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP")
    return null;
  const at = (i: number) => bytes[i] ?? 0;
  switch (ascii(12, 16)) {
    case "VP8X":
      return 1 + (at(24) | (at(25) << 8) | (at(26) << 16));
    case "VP8 ":
      return (at(26) | (at(27) << 8)) & 0x3fff;
    case "VP8L":
      return at(20) === 0x2f ? 1 + (at(21) | ((at(22) & 0x3f) << 8)) : null;
    default:
      return null;
  }
}

/** Check one offer's repository and offered release on GitHub. */
export async function verifySources(
  offer: Offer,
  github: GitHub,
): Promise<SourceReport> {
  const problems: string[] = [];
  const notes: string[] = [];
  const release = offeredRelease(offer);
  const repo = `/repos/${offer.repository}`;

  const repository = await github(repo);
  if (repository.status !== 200) {
    if (release.commit === null)
      notes.push(
        `${offer.repository} is not reachable yet (${repository.status}); Lazurio does not show the offer yet`,
      );
    else problems.push(`${offer.repository} answers ${repository.status}`);
    return { offer: offer.id, problems, notes };
  }
  const meta = record(json(repository.body));
  if (meta?.private !== false) {
    if (release.commit === null)
      notes.push(`${offer.repository} is not public yet`);
    else problems.push(`${offer.repository} is not public`);
    return { offer: offer.id, problems, notes };
  }
  if (meta.archived === true) problems.push(`${offer.repository} is archived`);

  const ref = release.commit;
  const license = await github(
    ref === null ? `${repo}/license` : `${repo}/license?ref=${ref}`,
  );
  const spdx =
    license.status === 200
      ? record(record(json(license.body))?.license)?.spdx_id
      : null;
  if (ref === null && (spdx === null || spdx === undefined))
    notes.push(`GitHub detects no license in ${offer.repository} yet`);
  else if (spdx !== offer.license)
    problems.push(
      `GitHub detects license ${String(spdx ?? "none")}, the offer says ${offer.license}`,
    );

  if (ref === null) {
    notes.push(`release ${release.version} has no commit yet`);
    return { offer: offer.id, problems, notes };
  }

  // The tag: annotated, and pointing to the recorded commit.
  const tagRef = await github(`${repo}/git/ref/tags/${release.tag}`);
  const tagObject =
    tagRef.status === 200 ? record(record(json(tagRef.body))?.object) : null;
  if (tagObject === null) problems.push(`tag ${release.tag} does not exist`);
  else if (tagObject.type !== "tag")
    problems.push(`tag ${release.tag} is not an annotated tag`);
  else {
    const tag = await github(`${repo}/git/tags/${String(tagObject.sha)}`);
    const target =
      tag.status === 200 ? record(record(json(tag.body))?.object) : null;
    if (target?.type !== "commit" || target.sha !== ref)
      problems.push(
        `tag ${release.tag} points to ${String(target?.sha ?? "nothing")}, not ${ref}`,
      );
  }
  const published = await github(`${repo}/releases/tags/${release.tag}`);
  if (published.status !== 200)
    problems.push(`no published GitHub Release for ${release.tag}`);

  const file = (path: string) => github(`${repo}/contents/${path}?ref=${ref}`);
  const jsonFile = async (path: string) => {
    const answer = await file(path);
    if (answer.status !== 200) return null;
    try {
      return record(json(answer.body));
    } catch {
      return null;
    }
  };

  for (const path of requiredFiles)
    if ((await file(path)).status !== 200)
      problems.push(`${path} is missing at ${ref}`);

  // lazurio.module.json and the offered generation's app, as the Module
  // Standard of LazurioPlatform (docs/module-standard.md) requires them.
  const app = `${release.generation}/package.json`;
  const manifest = await jsonFile("lazurio.module.json");
  if (manifest === null)
    problems.push(`lazurio.module.json is missing or not JSON at ${ref}`);
  else {
    if (manifest.schema_version !== "lazurio.module.v1")
      problems.push("lazurio.module.json is not lazurio.module.v1");
    if (manifest.id !== offer.module)
      problems.push(
        `lazurio.module.json names module ${String(manifest.id)}, the offer ${offer.module}`,
      );
    const apps = Array.isArray(manifest.apps) ? manifest.apps : [];
    if (!apps.includes(app) || manifest.default_app !== app)
      problems.push(`lazurio.module.json does not run ${app} by default`);
  }
  const pkg = await jsonFile(app);
  if (pkg === null) problems.push(`${app} is missing or not JSON at ${ref}`);
  else {
    if (pkg.packageManager !== `bun@${release.bun}`)
      problems.push(
        `${app} pins ${String(pkg.packageManager)}, the release bun@${release.bun}`,
      );
    const lazurio = record(pkg.lazurio);
    if (record(lazurio?.runtime)?.schema_version !== "lazurio.runtime.v1")
      problems.push(`${app} has no lazurio.runtime (lazurio.runtime.v1)`);
    if (record(lazurio?.preparation) === null)
      problems.push(`${app} has no lazurio.preparation`);
    if (typeof record(pkg.scripts)?.check !== "string")
      problems.push(`${app} has no check script`);
    if ((await file(`${release.generation}/bun.lock`)).status !== 200)
      problems.push(`${release.generation}/bun.lock is missing at ${ref}`);
  }

  for (const screenshot of offer.screenshots) {
    const answer = await file(screenshot.path);
    if (answer.status !== 200) {
      problems.push(`${screenshot.path} is missing at ${ref}`);
      continue;
    }
    const width = webpWidth(answer.body);
    if (width === null) problems.push(`${screenshot.path} is not WebP`);
    else if (width !== screenshotWidth)
      problems.push(
        `${screenshot.path} is ${width} px wide, not ${screenshotWidth}`,
      );
    if (answer.body.length > screenshotLimit)
      problems.push(`${screenshot.path} is larger than 2 MiB`);
  }
  if (release.artifactDigest !== null)
    notes.push("the artifact digest is recorded but not verified yet");
  return { offer: offer.id, problems, notes };
}

/** The GitHub REST API through fetch, with a token when there is one. */
export function gitHubApi(token: string | undefined): GitHub {
  return async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: path.includes("/contents/")
          ? "application/vnd.github.raw+json"
          : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "lazurio-marketplace-registry",
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
    });
    return {
      status: response.status,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  };
}
