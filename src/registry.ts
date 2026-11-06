import Ajv2020 from "ajv/dist/2020";
import indexSchema from "../schemas/index.v1.schema.json";
import offerSchema from "../schemas/offer.v1.schema.json";

// The registry's offline rules: the schema of one offer, what the schema
// cannot say (the file's place, the publisher, the order of releases) and
// what holds across offers (unique ids and repositories). Every rule here is
// checked without the network; scripts/verify-sources.ts checks the
// repositories themselves.

export type Localized = Readonly<{ cs: string; en: string }>;

export type Seed = Readonly<{ label: Localized; brief: Localized }>;

/** One release: its version and tag, what it is built on (the app
 * generation, the stack profile release, the scaffold stack and the exact
 * Bun, which a generation transition or a release of the stack profile
 * changes) and, once it is published, the commit its tag points to. */
export type Release = Readonly<{
  version: string;
  tag: string;
  generation: string;
  stackProfile: string;
  stack: string;
  bun: string;
  commit: string | null;
  artifactDigest: string | null;
}>;

export type Offer = Readonly<{
  schemaVersion: "lazurio.marketplace.offer.v1";
  id: string;
  section: "app-templates";
  /** One name for both languages, or a bilingual template's own in each. */
  title: string | Localized;
  module: string;
  repository: string;
  publisher: string;
  movedFrom?: string;
  license: string;
  stone: string;
  pricing: "free";
  summary: Localized;
  features: readonly Readonly<{ title: Localized; text: Localized }>[];
  seeds: Readonly<{ empty: Seed; sample?: Seed }>;
  screenshots: readonly Screenshot[];
  releases: readonly Release[];
}>;

/** The language of a screen's words. */
export type Locale = "cs" | "en";

/** A screen of the offered release: its path in the repository, its words
 * and, where the template has screens per language, its language. */
export type Screenshot = Readonly<{
  path: string;
  alt: Localized;
  locale?: Locale;
}>;

/** Screens per language at most, and without one. */
export const screenshotsPerLocale = 6;

/** What the schema cannot say of an offer's screens: without a language at
 * most six; with one, every screen names its language and Czech and English
 * have the same number (so at most six each), and each language lists a path
 * once. Lazurio shows the screens of the page's language, else those
 * without one, else any. */
export function screenshotProblems(
  screenshots: readonly Screenshot[],
): string[] {
  const problems: string[] = [];
  const keys = screenshots.map(
    (screenshot) => `${screenshot.locale ?? ""}:${screenshot.path}`,
  );
  if (new Set(keys).size !== keys.length)
    problems.push("a screenshot is listed twice");
  const localized = screenshots.filter(
    (screenshot) => screenshot.locale !== undefined,
  );
  if (localized.length === 0) {
    if (screenshots.length > screenshotsPerLocale)
      problems.push(
        `at most ${screenshotsPerLocale} screenshots without a locale`,
      );
    return problems;
  }
  if (localized.length !== screenshots.length)
    problems.push("once a screenshot names its locale, every one does");
  const cs = localized.filter((screenshot) => screenshot.locale === "cs");
  const en = localized.filter((screenshot) => screenshot.locale === "en");
  if (cs.length !== en.length)
    problems.push(
      `the screenshots in cs (${cs.length}) and en (${en.length}) are not as many`,
    );
  return problems;
}

/** One file of offers/ as read: its path relative to the registry root and
 * its parsed YAML, or why it could not be read as an offer. */
export type Entry = Readonly<
  { file: string; value: unknown } | { file: string; unreadable: string }
>;

export type Problem = Readonly<{ file: string; message: string }>;

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(offerSchema, "offer.v1.schema.json");
const validateOffer = ajv.compile<Offer>(offerSchema);
const validateIndexShape = ajv.compile(indexSchema);

/** The App generations each stack profile is for (LazurioPlatform
 * docs/stack-profiles.md): the generation names the data layer, and a
 * content module with data keeps the tools of content in app/v3. */
export const profileGenerations: Readonly<Record<string, readonly string[]>> = {
  content: ["app/v1", "app/v2", "app/v3"],
  app: ["app/v1", "app/v2"],
  "app-data": ["app/v3"],
  "app-database": ["app/v4"],
};

/** A release's stack profile split into the profile and its release, such
 * as app-data and 2026.11. */
export function splitStackProfile(stackProfile: string): {
  profile: string;
  release: string;
} {
  const at = stackProfile.indexOf("@");
  return {
    profile: stackProfile.slice(0, at),
    release: stackProfile.slice(at + 1),
  };
}

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Semantic version order (build metadata is not allowed here): negative
 * when a is lower. A prerelease is lower than its final version. */
export function compareVersions(a: string, b: string): number {
  const x = semver.exec(a);
  const y = semver.exec(b);
  if (x === null || y === null) throw new Error(`not a version: ${a}, ${b}`);
  for (const i of [1, 2, 3]) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  const p = x[4];
  const q = y[4];
  if (p === undefined || q === undefined)
    return p === q ? 0 : p === undefined ? 1 : -1;
  const ps = p.split(".");
  const qs = q.split(".");
  for (let i = 0; i < Math.max(ps.length, qs.length); i++) {
    const s = ps[i];
    const t = qs[i];
    if (s === undefined) return -1;
    if (t === undefined) return 1;
    const sn = /^\d+$/.test(s);
    const tn = /^\d+$/.test(t);
    if (sn && tn && Number(s) !== Number(t))
      return Math.sign(Number(s) - Number(t));
    if (sn !== tn) return sn ? -1 : 1;
    if (s !== t) return s < t ? -1 : 1;
  }
  return 0;
}

/** The release an offer stands for: the newest one whose commit is
 * recorded, which Lazurio offers, or, while none has one, the newest, and
 * Lazurio does not show the offer yet. */
export function offeredRelease(offer: Offer): Release {
  const first = offer.releases[0];
  if (first === undefined) throw new Error(`${offer.id} has no release`);
  return offer.releases.find((release) => release.commit !== null) ?? first;
}

/** The problems of one offer file, and the offer when it has none. */
export function checkOffer(entry: Entry): {
  offer: Offer | null;
  problems: Problem[];
} {
  const problem = (message: string): Problem => ({ file: entry.file, message });
  if ("unreadable" in entry)
    return { offer: null, problems: [problem(entry.unreadable)] };
  if (!validateOffer(entry.value))
    return {
      offer: null,
      problems: (validateOffer.errors ?? []).map((error) =>
        problem(
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
        ),
      ),
    };
  const offer = entry.value;
  const problems: Problem[] = [];
  const expected = `offers/${offer.publisher}/${offer.id}.yaml`;
  if (entry.file !== expected) problems.push(problem(`belongs at ${expected}`));
  const owner = offer.repository.split("/")[0];
  if (owner?.toLowerCase() !== offer.publisher.toLowerCase())
    problems.push(
      problem(`repository ${offer.repository} is not ${offer.publisher}'s`),
    );
  if (offer.movedFrom?.toLowerCase() === offer.repository.toLowerCase())
    problems.push(problem("movedFrom names the repository itself"));
  offer.releases.forEach((release, i) => {
    if (release.tag !== `v${release.version}`)
      problems.push(
        problem(
          `release ${release.version} must be tagged v${release.version}`,
        ),
      );
    const { profile } = splitStackProfile(release.stackProfile);
    if (!profileGenerations[profile]?.includes(release.generation))
      problems.push(
        problem(
          `release ${release.version}: stack profile ${profile} is not for ${release.generation}`,
        ),
      );
    if (release.commit === null && release.artifactDigest !== null)
      problems.push(
        problem(`release ${release.version} has a digest but no commit`),
      );
    const newer = offer.releases[i - 1];
    if (
      newer !== undefined &&
      compareVersions(newer.version, release.version) <= 0
    )
      problems.push(
        problem(
          `releases must be newest first, each once: ${newer.version} before ${release.version}`,
        ),
      );
  });
  for (const message of screenshotProblems(offer.screenshots))
    problems.push(problem(message));
  return { offer: problems.length === 0 ? offer : null, problems };
}

/** Every offer of the registry, or the problems that keep it from being
 * one: each file's own, and ids or repositories used twice. */
export function checkRegistry(entries: readonly Entry[]): {
  offers: Offer[];
  problems: Problem[];
} {
  const offers: Offer[] = [];
  const problems: Problem[] = [];
  const ids = new Map<string, string>();
  const repositories = new Map<string, string>();
  for (const entry of entries) {
    const result = checkOffer(entry);
    problems.push(...result.problems);
    if (result.offer === null) continue;
    const offer = result.offer;
    const sameId = ids.get(offer.id);
    if (sameId !== undefined)
      problems.push({
        file: entry.file,
        message: `id ${offer.id} is already ${sameId}'s`,
      });
    const key = offer.repository.toLowerCase();
    const sameRepository = repositories.get(key);
    if (sameRepository !== undefined)
      problems.push({
        file: entry.file,
        message: `repository ${offer.repository} is already ${sameRepository}'s`,
      });
    ids.set(offer.id, entry.file);
    repositories.set(key, entry.file);
    offers.push(offer);
  }
  return { offers, problems };
}

const localized = (text: Localized): Localized => ({
  cs: text.cs,
  en: text.en,
});

const seed = (value: Seed): Seed => ({
  label: localized(value.label),
  brief: localized(value.brief),
});

/** One offer with its keys in the schema's order, so the index does not
 * depend on how a file was written. */
function canonical(offer: Offer): Offer {
  return {
    schemaVersion: offer.schemaVersion,
    id: offer.id,
    section: offer.section,
    title:
      typeof offer.title === "string" ? offer.title : localized(offer.title),
    module: offer.module,
    repository: offer.repository,
    publisher: offer.publisher,
    ...(offer.movedFrom === undefined ? {} : { movedFrom: offer.movedFrom }),
    license: offer.license,
    stone: offer.stone,
    pricing: offer.pricing,
    summary: localized(offer.summary),
    features: offer.features.map((feature) => ({
      title: localized(feature.title),
      text: localized(feature.text),
    })),
    seeds: {
      empty: seed(offer.seeds.empty),
      ...(offer.seeds.sample === undefined
        ? {}
        : { sample: seed(offer.seeds.sample) }),
    },
    screenshots: offer.screenshots.map((screenshot) => ({
      path: screenshot.path,
      alt: localized(screenshot.alt),
      ...(screenshot.locale === undefined ? {} : { locale: screenshot.locale }),
    })),
    releases: offer.releases.map((release) => ({
      version: release.version,
      tag: release.tag,
      generation: release.generation,
      stackProfile: release.stackProfile,
      stack: release.stack,
      bun: release.bun,
      commit: release.commit,
      artifactDigest: release.artifactDigest,
    })),
  };
}

/** index.json: the offers by id, two-space JSON and a final newline. The
 * same offers give the same bytes. */
export function buildIndex(offers: readonly Offer[]): string {
  const sorted = [...offers]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(canonical);
  const index = {
    schemaVersion: "lazurio.marketplace.index.v1",
    offers: sorted,
  };
  if (!validateIndexShape(index))
    throw new Error("the generated index does not match its schema");
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Every file of offers/ under root, parsed. A file that is not YAML is an
 * entry that says why, so its problem names it. */
export async function readEntries(root: string): Promise<Entry[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob("offers/**/*").scan({ cwd: root }))
    files.push(file.split("\\").join("/"));
  files.sort();
  const entries: Entry[] = [];
  for (const file of files) {
    const text = await Bun.file(`${root}/${file}`).text();
    if (!file.endsWith(".yaml")) {
      entries.push({ file, unreadable: "offers/ holds only .yaml files" });
      continue;
    }
    try {
      entries.push({ file, value: Bun.YAML.parse(text) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      entries.push({ file, unreadable: `not YAML: ${reason}` });
    }
  }
  return entries;
}
