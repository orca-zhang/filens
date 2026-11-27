# Public API compatibility and package versions

FiLens versions its npm modules, standalone preview packages, CLI, plugins and mobile SDKs separately. The GitHub release tag identifies a coordinated set of artifacts. Check the release notes and package manifests for the versions shipped together. Applications can upgrade compatible packages independently. [Release notes](release-v0.6.8.md)

## Compatibility scope

- npm packages cover documented entry points and named exports, their public TypeScript types, supported import modes, documented CSS entry points, and documented behavior for options, events, errors, and lifecycle methods. The package `exports` map declares the available subpaths. Use package entry points for code and ship the complete runtime directory for standalone deployment. Chunk names, implementation files, undocumented DOM structure and CSS classes can change between builds. [Preview deployment](../packages/preview/README.md)
- The CLI covers documented commands, flags, exit codes and machine-readable output fields. Consumers should tolerate new optional JSON fields. Human-readable output, translated messages and error wording can change. Use documented error codes where available. [CLI contract](agent-cli.md)
- SDK and plugin releases cover the integration interfaces in their guides and the hosts listed for the tested release. Format coverage and visual fidelity are tracked by format, engine and platform. Corrections to rendering can change layout or pixels. [SDK guide](../sdk/README.md) · [Support matrix](support-matrix.md)

## Choosing a version

Use `major.minor.patch` for each artifact. A patch fixes behavior within the current contract. A compatible minor release can add APIs or capabilities. During `0.x`, ship compatible changes as patches when possible so ranges such as `^0.1.6` can receive them. Use a new minor for breaking changes in a `0.x` package and a new major after `1.0`. Previews of breaking changes can use a prerelease version and the npm `next` tag.

Removing an entry point, tightening an accepted input, adding a required field or callback to consumer-implemented interfaces, and raising a documented toolchain or host minimum are breaking changes. Consider how consumers use closed unions before adding a discriminant that can break exhaustive switches. When possible, ship the replacement and a deprecated alias in a compatible release. Explain the migration and the expected removal release in the package notes. Verify the alias until removal.

For example, the PPTX package accepts the new direct import while the core package keeps its original viewer, parser and driver exports and stylesheet. Both entry points use the same implementation. The PPTX package declares the minimum core release that supplies its shared support entry. [PPTX API](../packages/pptx/README.md) · [Core API](../packages/core/README.md)

## Dependencies and verification

Set a dependency or peer range to include the oldest release that supplies the behavior and types the package uses. Declare a shared host or another API that requires a single compatible instance as a peer. Update the consuming package's range and version when it starts using a newer entry point. Preserve older compatible releases in the range when the consumer still works with them. List packages that need a coordinated upgrade in the release notes.

For a release, compare the affected entries and types with the previous published contract. Pack the changed packages and exercise the tarballs in a consumer outside the workspace. Check the declared dependency ranges by installing the affected version combination, compiling representative imports, and exercising the runtime paths that changed. Check the oldest toolchain versions for which the release claims support. The existing consumer suites cover Bundler, Node16 and NodeNext resolution for scoped modules and production browser bundling for the standalone runtime. [Module consumer checks](../scripts/test-workspace-npm.mjs) · [Standalone consumer checks](../scripts/test-preview-npm.mjs) · [Node 24 CI](../.github/workflows/node24-package-compatibility.yml)

Record the exact package versions, the checks run and any migration instructions in the release evidence. Publish changed bytes under a new version. Registry validation uses exact package versions and a fresh cache, so a successful local tarball check and an available registry release each have their own evidence. [Module packaging](../scripts/package-workspace-npm.mjs) · [Publication script](../scripts/publish-agent-npm.mjs)
