# FiLens picomatch hotfix

This local package is based on the MIT-licensed `picomatch` 4.0.7 npm release.
It preserves the upstream entry points and parser API and adds one fail-closed
guard in `lib/parse.js`: a repeated `+()` or `*()` extglob with one branch that
contains an unescaped wildcard is treated as a literal pattern. The guard also
applies when `maxExtglobRecursion` is disabled, because that option controls a
separate heuristic.

The change addresses the published ReDoS shapes `+(*)` and `+(*a)` from
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
Regression checks are in `scripts/picomatch-hotfix.test.mjs` and run through
`npm run test:security`.

This is a repository-local compatibility hotfix, not an upstream release or a
claim that every possible picomatch ReDoS pattern has been eliminated. Patterns
in the guarded shape are matched literally, which can change behavior for those
patterns. Reassess and remove this fork after upstream ships and validates a
complete fix.
