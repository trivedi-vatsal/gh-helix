## What does this change?

<!-- One or two sentences: what changed and why. -->

## Related issue

<!-- Closes #123, or "N/A" -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / cleanup (no behavior change)
- [ ] CI / release engineering
- [ ] Other (describe above)

## Checklist

- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` all pass locally
- [ ] I added/updated tests for this change (see [docs/testing.md](../docs/testing.md))
- [ ] I updated relevant documentation ([docs/](../docs/), root [README.md](../README.md), [CHANGELOG.md](../CHANGELOG.md)) in this PR
- [ ] If this changes locking, transactions, safe-move, or CLI/exit-code behavior, I checked whether a [docs/adr/](../docs/adr/) entry needs to be added or updated

## Architecture impact

<!--
Does this touch the layered structure (commands/ -> api/, mirror/, metadata/ -> utils/)?
Does it change any documented guarantee (idempotency, crash-safety, locking, exit codes)?
If yes, explain briefly -- see docs/architecture.md.
-->

## How was this tested?

<!-- Manual steps, or "covered by new/existing automated tests in <file>". -->
