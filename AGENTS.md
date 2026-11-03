# Lazurio Marketplace registry: rules for agents

This repository is the registry the Marketplace in Lazurio reads: data
(`offers/`), its schemas, the generated `index.json` and a small validator.
Read `README.md` and `CONTRIBUTING.md` first.

- Change offers only through a pull request from a worktree. Merging is the
  listing, a curator's decision; never merge, tag or change the repository's
  visibility without the explicit instruction of the person you work for.
- After any change in `offers/` run `bun run index` and commit `index.json`
  with it. Run `bun run check` before every push; `bun run verify:sources`
  needs the network and a GitHub token for a higher rate limit.
- Record a release's `commit` only from the tag itself
  (`git rev-parse '<tag>^{commit}'` or the GitHub API), never from a branch.
  A release without a published tag keeps `commit: null`.
- Keep the schema backwards compatible within `offer.v1`: Lazurio reads
  `index.json` of whichever commit it pins, and an unknown field or value makes
  it refuse that index. A change Lazurio must understand first is a new schema
  version, landed in LazurioPlatform before here.
- Offers hold public facts only: no customer names, real company data,
  credentials or private repository names. Words in Czech and English, plain
  and true.
- Keep the tooling minimal: Bun, TypeScript, Biome and ajv. The stack profiles
  of the templates are still being chosen; do not add a framework here.
