# Pronto Release Script

Automated release workflow for Pronto that handles versioning, building, and publishing.

## Prerequisites

The script requires these tools to be installed:
- `git` - Version control
- `gh` - GitHub CLI (authenticated with your GitHub account)
- `pnpm` - Package manager
- `cargo` - Rust toolchain
- `hdiutil` - macOS tool for DMG operations (built-in)

### GitHub CLI Setup

Ensure `gh` is authenticated:
```bash
gh auth login
```

## Usage

```bash
./scripts/release.sh <version> <release-notes>
```

### Parameters

- **version**: Semantic version number (e.g., `0.4.3`)
- **release-notes**: Description of changes in this release

### Example

```bash
./scripts/release.sh 0.4.3 "Fix: improved PR notification detection and performance improvements"
```

## What the Script Does

The release script automates 8 steps:

1. **Validate inputs** - Checks version format and prerequisites
2. **Bump versions** - Updates version in:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
3. **Commit changes** - Creates a git commit with bumped versions
4. **Build** - Runs `pnpm tauri build --bundles dmg`
5. **Create git tag** - Tags the commit as `v<version>`
6. **Push to GitHub** - Pushes commits and tag to origin
7. **Create GitHub release** - Creates a release with the DMG file attached
8. **Update Homebrew tap** -
   - Clones your Homebrew tap repository
   - Updates `Casks/pronto.rb` with new version and SHA256
   - Pushes changes to the tap repository

## Safety Features

- **Validates version format** - Ensures semantic versioning
- **Checks git state** - Aborts if you have uncommitted changes
- **Verifies prerequisites** - Stops if required tools are missing
- **Confirmation prompt** - Shows planned changes before proceeding
- **Error handling** - Stops on any error with clear messages

## Environment Variables

The script uses these git configurations when updating the Homebrew tap:
- `user.email` - Set to `bot@pronto.local`
- `user.name` - Set to `Pronto Release Bot`

These are only configured within the temporary clone of your Homebrew tap.

## Troubleshooting

### "Working directory has uncommitted changes"
Commit or stash your changes before running the script:
```bash
git add .
git commit -m "Your message"
```

### "Missing required tools"
Install the missing tool. For example:
```bash
brew install gh  # GitHub CLI
```

### "Could not find DMG file after build"
The build may have failed. Check the build output above for errors.

### "Release creation failed"
Ensure `gh` is authenticated:
```bash
gh auth login
```

### Homebrew tap update failed
Ensure:
- You have push access to your Homebrew tap repository
- Your SSH key is configured for GitHub (or you're using HTTPS authentication)

## Manual Rollback

If something goes wrong, you can manually undo changes:

```bash
# Undo last commit and tag
git reset --soft HEAD~1
git tag -d v<version>

# Or, if you've already pushed
git push origin :v<version>  # Delete remote tag
git push origin --force-with-lease  # Force push to undo commit
```

## Next Steps

After a successful release:
1. Verify the GitHub release looks correct
2. Verify the Homebrew tap updated correctly
3. Test installing via Homebrew (if you have tap configured locally):
   ```bash
   brew reinstall pronto
   ```
