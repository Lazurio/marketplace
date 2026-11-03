# Adding your module template

Anyone may propose a module template. The registry lists templates a curator
of Lazurio has reviewed; your pull request is the proposal and its merge is
the listing.

## 1. Make the repository a template

The registry accepts a repository that follows the template contract:

- A **public** GitHub repository with a `LICENSE` GitHub detects (its SPDX
  identifier goes into the offer).
- `lazurio.module.json` (`lazurio.module.v1`) and the app in `app/v<N>/` as
  the [Lazurio Module Standard](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/module-standard.md)
  defines them: an exact `packageManager: bun@x.y.z`, a committed `bun.lock`,
  a strict `tsconfig.json`, `biome.json`, `lazurio.runtime` and
  `lazurio.preparation`. The app the offer names is the module's
  `default_app`.
- One command, `bun run check` (types, lint, tests, data validation), green in
  the repository's CI.
- Data (v3 and later): schemas and validation, an empty or invented seed. Never
  real company data, names or sign-ins.
- `README.md`, `AGENTS.md` (how an agent works on the module), `CHANGELOG.md`.
- `docs/adoption.md`: how an agent adopts the template into another
  Organization. It checks live rights and a name collision, creates a private
  module with `lazurio module create`, merges the pinned commit so it stays an
  ancestor (an update is a merge of a newer tag), prepares a pull request and
  merges or activates nothing without the person's instruction. Access for
  Teams is set the same way as for every module.
- `docs/extending.md`: how to develop the module further, move to the next app
  generation (a new `app/v<N+1>` beside the old one, switching `default_app`,
  migrating data) and take template updates (a merge of the new tag).
- Screens for the Marketplace card: WebP, 1600 px wide, invented content only,
  in the repository at the release.

## 2. Publish a release

A release is an annotated tag `v<semver>` and a GitHub Release. The version is
independent of the app generation.

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --verify-tag
git rev-parse 'v0.1.0^{commit}'   # the full commit for the offer
```

## 3. Open a pull request here

Add `offers/<publisher>/<id>.yaml`, where `<publisher>` owns the repository and
`<id>` is unique in the registry. Copy an existing offer as a start; the schema
is `schemas/offer.v1.schema.json`. Then:

```sh
bun install
bun run index            # regenerate index.json
bun run check
bun run verify:sources   # optional locally, CI runs it
```

Commit the offer and `index.json` together. The card's words come in Czech and
English: one line (`summary`) and up to four features. Say plainly what the app
does; no superlatives, ratings or promises.

Each release names its own `generation`, `stack` and `bun`. A new release of a
listed template is a pull request that adds it at the top of `releases` with
its commit and those three, and updates `screenshots` when the app looks
different. The offer shows in Lazurio once a release has its commit.

## 4. Curator review

CI checks the shape and the repository. A curator then reads the template: that
the adoption guide works, that the seed and screens hold no real data, that the
words are true. The curator may ask for changes. Merging is the listing;
Lazurio shows the offer from the registry's next commit it reads. Removing an
offer is also a pull request; it never deletes anybody's adopted module.

`pricing` is `free` for every template. Paid templates will come later through
the same registry.
