---
name: release-notes
description: Drafts user-facing release notes for the next version from the commits and merged pull requests since the previous release tag.
when-to-use: When the user asks for release notes, a changelog entry, a release summary or "what changed since vX".
argument-hint: "[version] [since-ref]"
paths:
  - "CHANGELOG.md"
  - "RELEASE.md"
  - "docs/releases/**"
---

# Draft release notes

## 1. Find the range

- The new version is the first argument, if given; otherwise read it from the
  project's manifest (`Cargo.toml`, `package.json`, `pyproject.toml`) or ask.
- The start of the range is the second argument, if given; otherwise the most recent
  tag reachable from `HEAD` (`git describe --tags --abbrev=0`).
- List the commits with `git log --no-merges --format='%h %s' <since>..HEAD` and,
  when the repository uses merge commits, the merged pull requests with
  `git log --merges --format='%h %s' <since>..HEAD`.

## 2. Read, don't just list

Commit subjects are written for developers. For every change that a user could notice,
open the diff or pull request description until you can say **what changed for the
user** in one sentence. Skip changes users cannot observe: refactors, test-only
changes, CI, dependency bumps without a visible effect, and reverted work.

## 3. Group and write

Use the project's existing `CHANGELOG.md` format when there is one. Otherwise:

```markdown
## <version> — YYYY-MM-DD

### Breaking changes
- <What stops working, and exactly what the user must do instead.>

### New
- <Capability, written from the user's point of view.> (#123)

### Improved
- …

### Fixed
- <Symptom the user saw, not the internal cause.> (#124)
```

Rules:
- Lead with breaking changes and give the migration step for each one.
- One bullet per user-visible change; merge commits that make up one feature.
- Present tense, no internal jargon, no commit hashes in the prose. Reference pull
  request or issue numbers when they exist.
- Credit external contributors by handle when the project does so already.

## 4. Deliver

Insert the section at the top of `CHANGELOG.md` if the project keeps one, otherwise
print it. List any commit you could not classify so the user can decide.
