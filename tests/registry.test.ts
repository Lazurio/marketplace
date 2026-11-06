import { describe, expect, test } from "bun:test";
import {
  buildIndex,
  checkOffer,
  checkRegistry,
  compareVersions,
  type Entry,
  type Offer,
  offeredRelease,
  readEntries,
} from "../src/registry";

const text = { cs: "Text", en: "Text" };

/** A release of the generation, stack profile, stack and Bun a test does
 * not care about. */
const release = (version: string, overrides: Record<string, unknown> = {}) => ({
  version,
  tag: `v${version}`,
  generation: "app/v1",
  stackProfile: "app@2026.11",
  stack: "vite-react",
  bun: "1.4.4",
  commit: null,
  artifactDigest: null,
  ...overrides,
});

const offer = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "lazurio.marketplace.offer.v1",
  id: "notes",
  section: "app-templates",
  title: "Notes",
  module: "notes",
  repository: "Example/notes",
  publisher: "Example",
  license: "MIT",
  stone: "book",
  pricing: "free",
  summary: text,
  features: [{ title: text, text }],
  seeds: { empty: { label: text, brief: text } },
  screenshots: [],
  releases: [release("0.1.0")],
  ...overrides,
});

const entry = (value: unknown, file = "offers/Example/notes.yaml"): Entry => ({
  file,
  value,
});

const messages = (value: unknown, file?: string) =>
  checkOffer(entry(value, file)).problems.map((problem) => problem.message);

describe("one offer", () => {
  test("a complete offer passes", () => {
    expect(checkOffer(entry(offer())).problems).toEqual([]);
  });

  test("the schema refuses unknown fields, a price and a short commit", () => {
    expect(messages(offer({ installs: 3 }))).not.toEqual([]);
    expect(messages(offer({ pricing: "paid" }))).not.toEqual([]);
    expect(
      messages(
        offer({
          releases: [release("0.1.0", { commit: "abc123" })],
        }),
      ),
    ).not.toEqual([]);
  });

  test("both languages are required", () => {
    expect(messages(offer({ summary: { cs: "Jen česky" } }))).not.toEqual([]);
  });

  test("a release names its generation app/v<N>, its stack and its Bun", () => {
    const one = (overrides: Record<string, unknown>) =>
      offer({ releases: [release("0.1.0", overrides)] });
    expect(messages(one({ generation: "app/v0" }))).not.toEqual([]);
    expect(messages(one({ generation: "v3" }))).not.toEqual([]);
    expect(messages(one({ bun: "1.4" }))).not.toEqual([]);
    expect(messages(one({ stack: "Vite React" }))).not.toEqual([]);
    expect(messages(one({ generation: undefined }))).not.toEqual([]);
  });

  test("a release names its stack profile release", () => {
    const one = (stackProfile: unknown) =>
      offer({ releases: [release("0.1.0", { stackProfile })] });
    expect(messages(one("app@2026.11.1"))).toEqual([]);
    expect(messages(one("content@2026.11"))).toEqual([]);
    expect(messages(one(undefined))).not.toEqual([]);
    expect(messages(one("app"))).not.toEqual([]);
    expect(messages(one("app@2026-11"))).not.toEqual([]);
    expect(messages(one("app@26.11"))).not.toEqual([]);
    expect(messages(one("vite-react@2026.11"))).not.toEqual([]);
  });

  test("the stack profile is the generation's", () => {
    const one = (generation: string, stackProfile: string) =>
      offer({ releases: [release("0.1.0", { generation, stackProfile })] });
    expect(messages(one("app/v2", "content@2026.11"))).toEqual([]);
    // A content module with data keeps the tools of content in app/v3.
    expect(messages(one("app/v3", "content@2026.11"))).toEqual([]);
    expect(messages(one("app/v4", "content@2026.11"))).toEqual([
      "release 0.1.0: stack profile content is not for app/v4",
    ]);
    expect(messages(one("app/v3", "app-data@2026.11"))).toEqual([]);
    expect(messages(one("app/v4", "app-database@2026.11"))).toEqual([]);
    expect(messages(one("app/v3", "app@2026.11"))).toEqual([
      "release 0.1.0: stack profile app is not for app/v3",
    ]);
    expect(messages(one("app/v1", "app-data@2026.11"))).toEqual([
      "release 0.1.0: stack profile app-data is not for app/v1",
    ]);
    expect(messages(one("app/v5", "app-database@2026.11"))).toEqual([
      "release 0.1.0: stack profile app-database is not for app/v5",
    ]);
  });

  test("the offer itself names no generation, stack profile, stack or Bun", () => {
    expect(messages(offer({ generation: "app/v1" }))).not.toEqual([]);
    expect(messages(offer({ stackProfile: "app@2026.11" }))).not.toEqual([]);
    expect(messages(offer({ bun: "1.4.4" }))).not.toEqual([]);
    expect(messages(offer({ stack: "vite-react" }))).not.toEqual([]);
  });

  test("releases may change the generation and the Bun", () => {
    expect(
      messages(
        offer({
          releases: [
            release("2.0.0", {
              generation: "app/v3",
              stackProfile: "app-data@2026.11",
              bun: "1.4.4",
            }),
            release("1.0.0", { generation: "app/v1", bun: "1.4.2" }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a screenshot stays inside the repository and is WebP", () => {
    const shot = (path: string) =>
      offer({ screenshots: [{ path, alt: text }] });
    expect(messages(shot("docs/screens/gallery.webp"))).toEqual([]);
    expect(messages(shot("../secret.webp"))).not.toEqual([]);
    expect(messages(shot("/etc/a.webp"))).not.toEqual([]);
    expect(messages(shot("docs/screens/gallery.png"))).not.toEqual([]);
  });

  test("screens without a locale stay as they were: at most six, each path once", () => {
    const shots = (count: number) =>
      offer({
        screenshots: Array.from({ length: count }, (_, i) => ({
          path: `docs/screens/${i}.webp`,
          alt: text,
        })),
      });
    expect(messages(shots(6))).toEqual([]);
    expect(messages(shots(7))).toEqual([
      "at most 6 screenshots without a locale",
    ]);
    const twice = { path: "docs/screens/a.webp", alt: text };
    expect(messages(offer({ screenshots: [twice, twice] }))).toEqual([
      "a screenshot is listed twice",
    ]);
  });

  test("screens per language: every one names cs or en, both sets as many, at most six each", () => {
    const set = (locale: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        path: `docs/screens/${locale}/${i}.webp`,
        alt: text,
        locale,
      }));
    const shots = (...sets: unknown[][]) => offer({ screenshots: sets.flat() });
    expect(messages(shots(set("cs", 4), set("en", 4)))).toEqual([]);
    expect(messages(shots(set("cs", 6), set("en", 6)))).toEqual([]);
    // The same file may serve both languages, once in each.
    const plain = { path: "docs/screens/plain.webp", alt: text };
    expect(
      messages(
        shots([
          { ...plain, locale: "cs" },
          { ...plain, locale: "en" },
        ]),
      ),
    ).toEqual([]);
    expect(
      messages(
        shots([
          { ...plain, locale: "cs" },
          { ...plain, locale: "cs" },
        ]),
      ),
    ).toContain("a screenshot is listed twice");
    expect(messages(shots(set("cs", 4), set("en", 3)))).toEqual([
      "the screenshots in cs (4) and en (3) are not as many",
    ]);
    expect(messages(shots(set("cs", 2)))).toEqual([
      "the screenshots in cs (2) and en (0) are not as many",
    ]);
    expect(messages(shots(set("cs", 2), set("en", 2), [plain]))).toEqual([
      "once a screenshot names its locale, every one does",
    ]);
    // The schema: a known language only, at most twelve screens in all.
    expect(messages(shots(set("de", 1)))).not.toEqual([]);
    expect(messages(shots(set("cs", 7), set("en", 7)))).not.toEqual([]);
  });

  test("a name is one string for both languages, or {cs, en} for a bilingual template", () => {
    expect(messages(offer({ title: "Time Tracker" }))).toEqual([]);
    expect(
      messages(offer({ title: { cs: "Evidence času", en: "Time Tracker" } })),
    ).toEqual([]);
    for (const title of [
      "",
      "x".repeat(61),
      { cs: "Evidence času" },
      { cs: "Evidence času", en: "" },
      { cs: "x".repeat(61), en: "Time Tracker" },
      { cs: "Evidence času", en: "Time Tracker", de: "Zeiterfassung" },
      7,
    ])
      expect(messages(offer({ title }))).not.toEqual([]);
  });

  test("an id is at most 32 characters, for Lazurio's 64-character prompt id", () => {
    const longest = "a".repeat(32);
    expect(
      messages(offer({ id: longest }), `offers/Example/${longest}.yaml`),
    ).toEqual([]);
    expect(
      messages(offer({ id: `${longest}a` }), `offers/Example/${longest}a.yaml`),
    ).not.toEqual([]);
  });

  test("the file lives under its publisher and id", () => {
    expect(messages(offer(), "offers/Other/notes.yaml")).toEqual([
      "belongs at offers/Example/notes.yaml",
    ]);
  });

  test("LazurioTemplates publishes from its own repositories as any publisher", () => {
    expect(
      messages(
        offer({
          repository: "LazurioTemplates/notes",
          publisher: "LazurioTemplates",
        }),
        "offers/LazurioTemplates/notes.yaml",
      ),
    ).toEqual([]);
  });

  test("the publisher owns the repository", () => {
    expect(messages(offer({ repository: "Other/notes" }))).toEqual([
      "repository Other/notes is not Example's",
    ]);
  });

  test("a release is tagged v<version> and listed newest first", () => {
    expect(
      messages(offer({ releases: [release("0.1.0", { tag: "v0.1" })] })),
    ).toEqual(["release 0.1.0 must be tagged v0.1.0"]);
    expect(
      messages(offer({ releases: [release("0.1.0"), release("0.2.0")] })),
    ).toEqual(["releases must be newest first, each once: 0.1.0 before 0.2.0"]);
    expect(
      messages(offer({ releases: [release("0.2.0"), release("0.2.0-rc.1")] })),
    ).toEqual([]);
  });

  test("a digest needs a commit", () => {
    expect(
      messages(
        offer({
          releases: [
            release("0.1.0", { artifactDigest: `sha256:${"a".repeat(64)}` }),
          ],
        }),
      ),
    ).toEqual(["release 0.1.0 has a digest but no commit"]);
  });

  test("an unreadable file is a problem of its own", () => {
    expect(
      checkOffer({ file: "offers/Example/notes.yml", unreadable: "not YAML" })
        .problems,
    ).toEqual([{ file: "offers/Example/notes.yml", message: "not YAML" }]);
  });
});

describe("the registry", () => {
  test("ids and repositories are unique", () => {
    const { problems } = checkRegistry([
      entry(offer()),
      entry(
        offer({
          id: "notes-two",
          publisher: "example",
          repository: "example/NOTES",
        }),
        "offers/example/notes-two.yaml",
      ),
    ]);
    expect(problems.map((problem) => problem.message)).toEqual([
      "repository example/NOTES is already offers/Example/notes.yaml's",
    ]);
    const twice = checkRegistry([
      entry(offer()),
      entry(
        offer({ publisher: "Other", repository: "Other/notes" }),
        "offers/Other/notes.yaml",
      ),
    ]);
    expect(twice.problems.map((problem) => problem.message)).toEqual([
      "id notes is already offers/Example/notes.yaml's",
    ]);
  });

  test("the offered release is the newest with a commit", () => {
    const commit = "a".repeat(40);
    const value = offer({
      releases: [release("0.2.0"), release("0.1.0", { commit })],
    });
    const result = checkOffer(entry(value));
    expect(result.offer).not.toBeNull();
    expect(offeredRelease(result.offer as Offer).version).toBe("0.1.0");
  });

  test("versions follow semantic version order", () => {
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBe(-1);
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  test("the index does not depend on order or key order", () => {
    const a = checkOffer(entry(offer())).offer as Offer;
    const b = checkOffer(
      entry(
        offer({
          id: "atlas",
          module: "atlas",
          repository: "Example/atlas",
        }),
        "offers/Example/atlas.yaml",
      ),
    ).offer as Offer;
    const shuffled = Object.fromEntries(
      Object.entries(a).reverse(),
    ) as unknown as Offer;
    expect(buildIndex([a, b])).toBe(buildIndex([b, shuffled]));
    expect(JSON.parse(buildIndex([a, b])).offers[0].id).toBe("atlas");
  });

  test("the index keeps a screen's locale and adds none where an offer has none", () => {
    const plain = checkOffer(
      entry(
        offer({
          screenshots: [{ path: "docs/screens/a.webp", alt: text }],
        }),
      ),
    ).offer as Offer;
    expect(JSON.parse(buildIndex([plain])).offers[0].screenshots).toEqual([
      { path: "docs/screens/a.webp", alt: text },
    ]);
    const localized = checkOffer(
      entry(
        offer({
          screenshots: [
            { locale: "cs", path: "docs/screens/cs.webp", alt: text },
            { locale: "en", path: "docs/screens/en.webp", alt: text },
          ],
        }),
      ),
    ).offer as Offer;
    expect(
      Object.keys(JSON.parse(buildIndex([localized])).offers[0].screenshots[0]),
    ).toEqual(["path", "alt", "locale"]);
  });

  test("the index keeps a one-string name as it is and a bilingual one as {cs, en}", () => {
    const named = (title: unknown) =>
      JSON.parse(
        buildIndex([checkOffer(entry(offer({ title }))).offer as Offer]),
      ).offers[0].title;
    expect(named("Notes")).toBe("Notes");
    const both = named({ en: "Time Tracker", cs: "Evidence času" });
    expect(Object.entries(both)).toEqual([
      ["cs", "Evidence času"],
      ["en", "Time Tracker"],
    ]);
  });

  test("the registry's own offers are valid and index.json is current", async () => {
    const root = `${import.meta.dir}/..`;
    const { offers, problems } = checkRegistry(await readEntries(root));
    expect(problems).toEqual([]);
    expect(offers.length).toBeGreaterThan(0);
    expect(await Bun.file(`${root}/index.json`).text()).toBe(
      buildIndex(offers),
    );
  });
});
