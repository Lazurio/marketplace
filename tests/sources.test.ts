import { describe, expect, test } from "bun:test";
import type { Offer, Release } from "../src/registry";
import {
  type GitHub,
  namesStackProfile,
  requiredFiles,
  verifySources,
  webpWidth,
} from "../src/sources";

const commit = "c".repeat(40);
const tagSha = "d".repeat(40);
const text = { cs: "Text", en: "Text" };

const release = (overrides: Partial<Release> = {}): Release => ({
  version: "1.0.0",
  tag: "v1.0.0",
  generation: "app/v3",
  stackProfile: "app-data@2026.11",
  stack: "vite-react",
  bun: "1.4.4",
  commit,
  artifactDigest: null,
  ...overrides,
});

const offer = (overrides: Partial<Offer> = {}): Offer => ({
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
  screenshots: [{ path: "docs/screens/a.webp", alt: text }],
  releases: [release()],
  ...overrides,
});

/** A WebP header of the extended format with the given width. */
function webp(width: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
  const w = width - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  return bytes;
}

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

/** A repository that satisfies the contract, with answers to replace. */
function repository(replace: Record<string, unknown> = {}): GitHub {
  const repo = "/repos/Example/notes";
  const files: Record<string, unknown> = {
    [`${repo}`]: { private: false, archived: false },
    [`${repo}/license?ref=${commit}`]: { license: { spdx_id: "MIT" } },
    [`${repo}/git/ref/tags/v1.0.0`]: { object: { type: "tag", sha: tagSha } },
    [`${repo}/git/tags/${tagSha}`]: { object: { type: "commit", sha: commit } },
    [`${repo}/releases/tags/v1.0.0`]: { draft: false },
    [`${repo}/contents/lazurio.module.json?ref=${commit}`]: {
      schema_version: "lazurio.module.v1",
      id: "notes",
      apps: ["app/v3/package.json"],
      default_app: "app/v3/package.json",
    },
    [`${repo}/contents/app/v3/package.json?ref=${commit}`]: {
      packageManager: "bun@1.4.4",
      scripts: { check: "bun run typecheck" },
      lazurio: {
        runtime: { schema_version: "lazurio.runtime.v1" },
        preparation: {},
      },
    },
    [`${repo}/contents/app/v3/bun.lock?ref=${commit}`]: {},
    [`${repo}/contents/docs/screens/a.webp?ref=${commit}`]: webp(1600),
    ...Object.fromEntries(
      requiredFiles.map((path) => [
        `${repo}/contents/${path}?ref=${commit}`,
        {},
      ]),
    ),
    [`${repo}/contents/README.md?ref=${commit}`]: new TextEncoder().encode(
      "Built on the stack profile `app-data@2026.11`.",
    ),
    ...replace,
  };
  return async (path) => {
    const value = files[path];
    if (value === undefined || value === null)
      return { status: 404, body: new Uint8Array() };
    return {
      status: 200,
      body: value instanceof Uint8Array ? value : encode(value),
    };
  };
}

describe("an offer's sources", () => {
  test("a repository that satisfies the contract passes", async () => {
    const report = await verifySources(offer(), repository());
    expect(report.problems).toEqual([]);
  });

  test("a private repository fails an adoptable release", async () => {
    const report = await verifySources(
      offer(),
      repository({ "/repos/Example/notes": { private: true } }),
    );
    expect(report.problems).toEqual(["Example/notes is not public"]);
  });

  test("an announced offer only notes a missing repository", async () => {
    const pending = offer({
      releases: [release({ version: "0.1.0", tag: "v0.1.0", commit: null })],
    });
    const report = await verifySources(
      pending,
      repository({ "/repos/Example/notes": null }),
    );
    expect(report.problems).toEqual([]);
    expect(report.notes).toHaveLength(1);
  });

  test("an announced offer notes a missing license and fails another one", async () => {
    const pending = offer({ releases: [release({ commit: null })] });
    const missing = await verifySources(pending, repository());
    expect(missing.problems).toEqual([]);
    expect(missing.notes).toContain(
      "GitHub detects no license in Example/notes yet",
    );
    const other = await verifySources(
      pending,
      repository({
        "/repos/Example/notes/license": { license: { spdx_id: "GPL-3.0" } },
      }),
    );
    expect(other.problems).toEqual([
      "GitHub detects license GPL-3.0, the offer says MIT",
    ]);
  });

  test("a released offer fails without a license", async () => {
    const report = await verifySources(
      offer(),
      repository({ [`/repos/Example/notes/license?ref=${commit}`]: null }),
    );
    expect(report.problems).toEqual([
      "GitHub detects license none, the offer says MIT",
    ]);
  });

  test("a lightweight tag or one at another commit fails", async () => {
    const light = await verifySources(
      offer(),
      repository({
        "/repos/Example/notes/git/ref/tags/v1.0.0": {
          object: { type: "commit", sha: commit },
        },
      }),
    );
    expect(light.problems).toEqual(["tag v1.0.0 is not an annotated tag"]);
    const moved = await verifySources(
      offer(),
      repository({
        [`/repos/Example/notes/git/tags/${tagSha}`]: {
          object: { type: "commit", sha: "e".repeat(40) },
        },
      }),
    );
    expect(moved.problems).toEqual([
      `tag v1.0.0 points to ${"e".repeat(40)}, not ${commit}`,
    ]);
  });

  test("the license must be the one GitHub detects", async () => {
    const report = await verifySources(
      offer({ license: "Apache-2.0" }),
      repository(),
    );
    expect(report.problems).toEqual([
      "GitHub detects license MIT, the offer says Apache-2.0",
    ]);
  });

  test("the offered release's generation must be the default app", async () => {
    const report = await verifySources(
      offer({ releases: [release({ generation: "app/v4" })] }),
      repository(),
    );
    expect(report.problems).toContain(
      "lazurio.module.json does not run app/v4/package.json by default",
    );
  });

  test("the app pins the offered release's Bun", async () => {
    const report = await verifySources(
      offer({ releases: [release({ bun: "1.4.5" })] }),
      repository(),
    );
    expect(report.problems).toEqual([
      "app/v3/package.json pins bun@1.4.4, the release bun@1.4.5",
    ]);
  });

  test("an older release's generation and Bun do not matter", async () => {
    const report = await verifySources(
      offer({
        releases: [
          release(),
          release({
            version: "0.9.0",
            tag: "v0.9.0",
            generation: "app/v1",
            stackProfile: "app@2026.05",
            bun: "1.4.2",
          }),
        ],
      }),
      repository(),
    );
    expect(report.problems).toEqual([]);
  });

  test("the README or docs/extending.md names the stack profile", async () => {
    const readme = `/repos/Example/notes/contents/README.md?ref=${commit}`;
    const extending = `/repos/Example/notes/contents/docs/extending.md?ref=${commit}`;
    const words = (text: string) => new TextEncoder().encode(text);
    const silent = await verifySources(
      offer(),
      repository({ [readme]: words("A template.") }),
    );
    expect(silent.problems).toEqual([
      "README.md and docs/extending.md do not name the stack profile app-data@2026.11",
    ]);
    const inGuide = await verifySources(
      offer(),
      repository({
        [readme]: words("A template."),
        [extending]: words("The stack profile app-data@2026.11 pins Bun."),
      }),
    );
    expect(inGuide.problems).toEqual([]);
    const missing = await verifySources(
      offer(),
      repository({ [readme]: null }),
    );
    expect(missing.problems).toEqual([
      `README.md is missing at ${commit}`,
      "README.md and docs/extending.md do not name the stack profile app-data@2026.11",
    ]);
  });

  test("a screenshot is a 1600 px WebP", async () => {
    const report = await verifySources(
      offer(),
      repository({
        [`/repos/Example/notes/contents/docs/screens/a.webp?ref=${commit}`]:
          webp(800),
      }),
    );
    expect(report.problems).toEqual([
      "docs/screens/a.webp is 800 px wide, not 1600",
    ]);
  });
});

test("namesStackProfile finds the profile's release, not a neighbour", () => {
  const link =
    "https://github.com/Lazurio/LazurioPlatform/blob/main/docs/stack-profiles.md";
  expect(namesStackProfile("on `content@2026.11`", "content@2026.11")).toBe(
    true,
  );
  expect(
    namesStackProfile(
      `[\`app-data\`](${link}#app-data), release 2026.11: Bun 1.4.4`,
      "app-data@2026.11",
    ),
  ).toBe(true);
  expect(namesStackProfile("app-data@2026.11.1", "app-data@2026.11.1")).toBe(
    true,
  );
  expect(namesStackProfile("app-data@2026.11", "app@2026.11")).toBe(false);
  expect(namesStackProfile("app-data@2026.11.1", "app-data@2026.11")).toBe(
    false,
  );
  expect(namesStackProfile("app-data@2026.110", "app-data@2026.11")).toBe(
    false,
  );
  expect(
    namesStackProfile(`(${link}#app-database), 2026.11`, "app-data@2026.11"),
  ).toBe(false);
  expect(
    namesStackProfile(`(${link}#app-data), 2027.05`, "app-data@2026.11"),
  ).toBe(false);
});

test("webpWidth reads a WebP header and refuses other bytes", () => {
  expect(webpWidth(webp(1600))).toBe(1600);
  expect(webpWidth(new TextEncoder().encode("not an image at all, no"))).toBe(
    null,
  );
});
