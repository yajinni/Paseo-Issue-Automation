# Publishing

1. Complete a live end-to-end test in a disposable repository.
2. Update `CHANGELOG.md` and the package version.
3. Confirm CI passes on Node 20, 22, and 24, including the packed-archive smoke test.
4. Add the npm automation token as the `NPM_TOKEN` repository secret.
5. Create and push a matching version tag, such as `v0.1.0`.
6. The Release workflow tests the exact tag and publishes with npm provenance.

Do not publish from an uncommitted working tree or directly from a source checkout without testing the produced `.tgz` archive.
