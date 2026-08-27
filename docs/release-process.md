# Publishing an InfoSteed release

Only the repository owner approves official tags, GHCR publication, browser-store uploads, and announcements. Pushing a signed `v*` tag authorizes container publication; an untagged `main` commit never publishes an image.

## 1. Prepare the candidate on `main`

Routine pushes run formatting, SPDX, licence-notice, release-metadata, type, unit, and build checks. Python, production Compose, and HTTP integration jobs run only when their relevant paths change. CodeQL runs separately. Superseded CI and CodeQL runs are cancelled automatically, and an untagged commit never publishes a container image.

Before release, update the root and workspace versions, active deployment examples, release-status documents, and changelog together. Set the root `package.json` `releaseStatus` to `candidate`; the tag workflow deliberately rejects metadata already claiming publication. The candidate changelog entry must use its intended ISO release date rather than `Unreleased`. Push the preparation commit and wait for both CI and CodeQL to pass on that exact commit.

Exercise backup and restore with populated data and compare the Chrome offline and store packages built from the same commit as part of the manual readiness work. For an application-only release, also compare the Chrome package with the already-published extension and record that no browser-store submission is required.

## 2. Rehearse the container release

Run [Container security](https://github.com/infosteed/infosteed/actions/workflows/container-security.yml) manually on the candidate commit and wait for every job to pass. The workflow also runs weekly.

The rehearsal performs the production dependency audit, full-history secret scan, extension packaging and SBOM generation, and Linux amd64 builds, SBOM generation, and high/critical Trivy scans for the API, web, render-worker, and transcription images. It does not publish images. Successful builds populate per-image BuildKit caches that the tag workflow can reuse.

This rehearsal is deliberately separate from routine push CI so four production images are not rebuilt for every commit. It is also separate from the tag workflow because a signed release tag and any images published from it are immutable. Do not tag a candidate whose rehearsal failed or ran against a different commit.

## 3. Verify and push the signed tag

Start from a clean checkout synchronized with the successful candidate commit. The root package version must exactly match the tag without its `v` prefix:

```bash
git pull --ff-only origin main
test -z "$(git status --porcelain)"
version=$(node -p "require('./package.json').version")
corepack pnpm release-metadata:check -- --release-tag "v$version"
git tag -s "v$version" -m "InfoSteed $version"
git tag -v "v$version"
git push origin "v$version"
```

Tag-mode metadata validation requires the matching changelog entry to carry an ISO release date rather than `Unreleased`. It also verifies active deployment documentation, environment examples, runtime defaults, shared metadata, and workspace manifests against the root package version.

The [Publish release](https://github.com/infosteed/infosteed/actions/workflows/release.yml) workflow verifies the signed tag and repeats the release-critical application, dependency, licence, secret, extension, and container checks. It publishes Linux amd64 API, web, render-worker, and transcription images to GHCR, scans each published digest, attaches SBOM and provenance metadata, and creates a draft GitHub Release. The verified Chrome extension packages are passed between jobs rather than rebuilt for attachment.

Release tags, versioned image tags, and `sha-<commit>` image tags are never overwritten; there is no floating `latest` or `edge` tag. If a tag workflow fails after publishing any image, do not move the tag, delete and recreate it, or attempt to overwrite an image. Diagnose the failure and prepare a new version.

## 4. Verify the generated draft

Use the draft named `InfoSteed <version>` created by the workflow. Do not delete it or create a second release for the tag. Confirm that it contains both extension ZIPs, extension checksums and contents, the extension SBOM, `SHA256SUMS`, `production-images.env`, the deployment archive, and the individual deployment, documentation, licence, and operational files.

Verify `SHA256SUMS`, inspect the four immutable digests in `production-images.env`, make all four GHCR packages public, and test anonymous image inspection or pulls. Test both the GHCR and source-build production installation paths. Record the workflow run URLs, candidate commit, tag verification, image digests, and test results with the readiness evidence.

## 5. Soak and publish

Keep the GitHub Release as a draft while running the candidate privately for one week and completing [`release-readiness.md`](release-readiness.md). Release notes must list migrations, limitations, supported versions, backup requirements, image references, and rollback instructions.

When all evidence is complete, edit the workflow-created draft, mark it as a prerelease, and publish that same draft. Then change `releaseStatus` to `published`, synchronize the public-status documentation, and commit that post-publication state on `main`. Submit the browser extension manually only when its packaged code or metadata changed; an application-only release continues using the existing Chrome Web Store version. Announce the public beta only after publication.

Do not publish a candidate with a high- or critical-severity production vulnerability. Record an owner, justification, and expiry for any accepted lower-severity finding.

## Rollback

Database migrations are forward-only. Stop writers, use `scripts/restore.sh --confirm-replace-target` with the verified pre-upgrade backup, and start the previous versioned image set. Never run an older image against a newer database.
