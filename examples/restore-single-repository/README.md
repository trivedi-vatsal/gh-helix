# Example: restore a single repository

The most common recovery scenario — one repository was deleted, corrupted, or you just need a
fresh working copy from the mirror.

## Command

```bash
gh-helix restore my-repo
```

Restores into `./my-repo` (the default destination) relative to the current directory. To choose
a different location:

```bash
gh-helix restore my-repo --destination D:\Restore\my-repo
```

## Expected output

```
✓ Restored my-repo -> D:\Restore\my-repo (LFS: rehydrated)
```

Exit `0`. If LFS objects couldn't be confirmed rehydrated, exit `1` with `RestoreLfsError` details
— see [../../docs/troubleshooting.md#lfs-errors](../../docs/troubleshooting.md#lfs-errors).

## Recovering it back onto GitHub

`restore` produces a local working copy only — it doesn't push anywhere. To fully recover the
repository on GitHub:

```bash
cd D:\Restore\my-repo
git remote set-url origin https://github.com/my-org/my-repo.git   # or a newly created empty repo
git push origin --all
git push origin --tags
```

## If the destination already has files in it

```
✗ Destination D:\Restore\my-repo already exists and is not empty
```

Exit `4`. Choose an empty or non-existent destination — `restore` refuses to merge into or
overwrite an existing non-empty directory. See
[../../docs/restore-workflow.md#3-validate-the-destination](../../docs/restore-workflow.md#3-validate-the-destination).

## If no mirror exists yet

```
✗ No local mirror found for 'my-repo'. Run 'backup' first.
```

Exit `4` — `restore` only reads from an existing mirror; run `gh-helix backup` at least once
first.

## Best practices

- Restore into a scratch directory first if you're unsure of the repository's exact state before
  deciding where it should ultimately live.
- If the restore is interrupted (killed, crashed), just run the exact same command again — it
  resumes from the staged, partially-verified copy rather than starting over. See
  [../../docs/restore-workflow.md#4-resume-check](../../docs/restore-workflow.md#4-resume-check).
