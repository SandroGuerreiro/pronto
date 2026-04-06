#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOMEBREW_TAP_URL="https://github.com/sandroguerreiro/homebrew-tap"
CASK_NAME="pronto"

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if version format is valid (semver)
validate_version() {
    if [[ ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        log_error "Invalid version format. Please use semantic versioning (e.g., 0.4.3)"
        exit 1
    fi
}

# Generate release notes from commits since last tag
generate_release_notes() {
    local new_version=$1
    local last_tag=$(git describe --tags --abbrev=0 2>/dev/null)

    if [ -z "$last_tag" ]; then
        log_warning "No previous tag found, using all commits"
        last_tag=$(git rev-list --max-parents=0 HEAD)
    fi

    log_info "Generating release notes from commits since $last_tag..."

    local commits=$(git log "${last_tag}..HEAD" --pretty=format:"%s" --no-merges | grep -v "^Bump version")

    if [ -z "$commits" ]; then
        echo "- Maintenance release"
        return
    fi

    if ! command -v claude &> /dev/null; then
        log_warning "Claude Code not found, falling back to raw commit messages"
        echo "$commits" | sed 's/^/- /'
        return
    fi

    local prompt="You are writing release notes for Pronto v${new_version}, a macOS menu bar app for GitHub PR monitoring.

Below are the git commit messages since the last release (${last_tag}).
Write concise, user-friendly release notes in markdown bullet points.
Group related changes together. Use clear, non-technical language where possible.
Skip version bump commits. Do not add a heading or preamble — just the bullet points.

Commits:
${commits}"

    echo "$prompt" | claude -p --model haiku 2>/dev/null

    if [ $? -ne 0 ]; then
        log_warning "Claude failed, falling back to raw commit messages"
        echo "$commits" | sed 's/^/- /'
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    local missing_tools=()

    # Check for required tools
    for tool in git gh pnpm cargo create-dmg xcrun; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done

    if [ ${#missing_tools[@]} -gt 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        exit 1
    fi

    # Check for notarization credentials
    for var in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
        if [ -z "${!var}" ]; then
            log_error "Missing environment variable: $var (required for notarization)"
            exit 1
        fi
    done

    log_success "All prerequisites met"
}

# Verify git state is clean
check_git_state() {
    log_info "Checking git state..."

    if ! git -C "$PROJECT_ROOT" diff-index --quiet HEAD --; then
        log_error "Working directory has uncommitted changes. Please commit or stash them first."
        exit 1
    fi

    log_success "Git working directory is clean"
}

# Bump version in a file
bump_version_in_file() {
    local file=$1
    local old_version=$2
    local new_version=$3

    if ! grep -q "$old_version" "$file"; then
        log_error "Could not find version $old_version in $file"
        exit 1
    fi

    sed -i '' "s/$old_version/$new_version/g" "$file"
    log_success "Updated version in $file"
}

# Check what's already been done
check_completion_status() {
    local new_version=$1
    local dmg_path="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg/Pronto_${new_version}_aarch64.dmg"

    local status=""

    # Check version bumps
    if grep -q "\"version\": \"$new_version\"" "$PROJECT_ROOT/package.json"; then
        status="${status}1"
    fi

    # Check if commit was made
    if git -C "$PROJECT_ROOT" log --oneline | grep -q "Bump version to $new_version"; then
        status="${status}2"
    fi

    # Check if build artifacts exist with correct version
    local app_plist="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/Pronto.app/Contents/Info.plist"
    if [ -f "$app_plist" ] && defaults read "$app_plist" CFBundleShortVersionString 2>/dev/null | grep -q "^${new_version}$"; then
        status="${status}3"
    fi

    # Check if DMG was created
    if [ -f "$dmg_path" ]; then
        status="${status}4"
    fi

    # Check if tag exists
    if git -C "$PROJECT_ROOT" rev-parse "v$new_version" >/dev/null 2>&1; then
        status="${status}5"
    fi

    # Check if GitHub release exists
    if gh -C "$PROJECT_ROOT" release view "v$new_version" >/dev/null 2>&1; then
        status="${status}6"
    fi

    echo "$status"
}

# Main release function
main() {
    local from_step=""
    local force_redo=""

    if [ $# -lt 1 ]; then
        echo "Usage: $0 <version> [release-notes] [options]"
        echo "Options:"
        echo "  --from-step N      Start from step N (1-8), auto-skip completed steps"
        echo "  --force-from-step N Start from step N, redo that step even if completed"
        echo ""
        echo "Example: $0 0.4.3 'Fix: improved PR detection'"
        echo "Auto notes: $0 0.4.3"
        echo "Resume: $0 0.4.3 --from-step 4"
        exit 1
    fi

    local new_version=$1
    shift

    # Check if second arg is release notes or an option
    local release_notes=""
    if [ $# -gt 0 ] && [[ ! "$1" =~ ^-- ]]; then
        release_notes=$1
        shift
    fi

    # Parse options
    while [ $# -gt 0 ]; do
        case "$1" in
            --from-step)
                from_step=$2
                shift 2
                ;;
            --force-from-step)
                from_step=$2
                force_redo=1
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    # Validate version format
    validate_version "$new_version"

    # Check prerequisites
    check_prerequisites

    cd "$PROJECT_ROOT"

    # Get current version from package.json
    local current_version=$(grep '"version"' package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')

    # Auto-generate release notes if not provided
    if [ -z "$release_notes" ]; then
        release_notes=$(generate_release_notes "$new_version")
        log_info "Auto-generated release notes:"
        echo -e "$release_notes"
        echo ""
        read -p "Use these notes? (Y/n/e=edit) " choice
        case "$choice" in
            n|N)
                read -p "Enter release notes: " release_notes
                ;;
            e|E)
                local tmpfile=$(mktemp)
                echo "$release_notes" > "$tmpfile"
                ${EDITOR:-vim} "$tmpfile"
                release_notes=$(cat "$tmpfile")
                rm -f "$tmpfile"
                ;;
        esac
    fi

    log_info "Current version: $current_version"
    log_info "New version: $new_version"
    log_info "Release notes: $release_notes"

    # Check what's been completed
    local completion_status=$(check_completion_status "$new_version")
    log_info "Completion status: $completion_status (1=bumped 2=committed 3=built 4=dmg 5=tagged 6=released)"

    # Determine starting step
    if [ -z "$from_step" ]; then
        # Auto-detect next incomplete step
        if [[ ! "$completion_status" =~ 1 ]]; then
            from_step=1
        elif [[ ! "$completion_status" =~ 2 ]]; then
            from_step=2
        elif [[ ! "$completion_status" =~ 3 ]]; then
            from_step=3
        elif [[ ! "$completion_status" =~ 4 ]]; then
            from_step=4
        elif [[ ! "$completion_status" =~ 5 ]]; then
            from_step=5
        elif [[ ! "$completion_status" =~ 6 ]]; then
            from_step=6
        else
            from_step=7
        fi
        log_info "Auto-detected starting step: $from_step"
    elif ! [[ "$from_step" =~ ^[1-8]$ ]]; then
        log_error "Invalid step number. Must be 1-8"
        exit 1
    fi

    # Check git state only if starting from scratch
    if [ "$from_step" -eq 1 ] && [ -z "$force_redo" ]; then
        check_git_state
        read -p "Press Enter to continue with the release, or Ctrl+C to cancel..."
    fi

    # Step 1: Bump versions
    if [ "$from_step" -le 1 ]; then
        if [[ "$completion_status" =~ 1 ]] && [ -z "$force_redo" ]; then
            log_info "Step 1/8: Version already bumped, skipping..."
        else
            log_info "Step 1/8: Bumping versions..."
            bump_version_in_file "$PROJECT_ROOT/package.json" "$current_version" "$new_version"
            bump_version_in_file "$PROJECT_ROOT/src-tauri/tauri.conf.json" "$current_version" "$new_version"
            bump_version_in_file "$PROJECT_ROOT/src-tauri/Cargo.toml" "$current_version" "$new_version"
            # Regenerate Cargo.lock with the new version
            (cd "$PROJECT_ROOT/src-tauri" && cargo update --workspace)
            log_success "Versions bumped"

            # Update documentation with Claude
            local last_tag=$(git describe --tags --abbrev=0 2>/dev/null)
            local commits=$(git log "${last_tag}..HEAD" --pretty=format:"%s" --no-merges 2>/dev/null)

            if command -v claude &> /dev/null; then
                read -p "Update CLAUDE.md, MEMORY.md, and README.md with Claude? (Y/n) " update_docs
                if [[ ! "$update_docs" =~ ^[nN]$ ]]; then
                    local docs_prompt="I just released Pronto v${new_version} (previous: ${last_tag}). Here are the changes since the last release:

${commits}

Please update the following files:
1. CLAUDE.md — update the version number (Current version: ...) and add/update any sections that reflect the new changes
2. ~/.claude/projects/-Users-sandroguerreiro-Code-pronto/memory/MEMORY.md — update the version number and add any relevant notes about new features or changes
3. README.md — update version references and feature descriptions if the changes warrant it

Only make changes that are necessary. Keep the existing structure and style of each file. Do not remove existing content unless it's outdated."

                    echo "$docs_prompt" | claude -p
                    log_success "Documentation updated"
                fi
            else
                log_warning "Claude Code not found, skipping documentation update"
            fi
        fi
    fi

    # Step 2: Commit version bump + docs
    if [ "$from_step" -le 2 ]; then
        if [[ "$completion_status" =~ 2 ]] && [ -z "$force_redo" ]; then
            log_info "Step 2/8: Version already committed, skipping..."
        else
            log_info "Step 2/8: Committing version bump + docs..."
            git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
            git add CLAUDE.md README.md 2>/dev/null || true
            git commit -m "Bump version to $new_version"
            log_success "Version bump committed"
        fi
    fi

    # Step 3: Build Tauri app
    if [ "$from_step" -le 3 ]; then
        if [[ "$completion_status" =~ 3 ]] && [ -z "$force_redo" ]; then
            log_info "Step 3/8: App already built, skipping..."
        else
            log_info "Step 3/8: Building Tauri app..."
            # Clean dist folder to ensure fresh frontend build
            rm -rf "$PROJECT_ROOT/dist"
            if ! pnpm tauri build --bundles app; then
                log_error "Build failed. Resume with: $0 $new_version --force-from-step 3"
                exit 1
            fi
            log_success "Build completed"
        fi
    fi

    # Step 4: Notarize, staple, and create DMG
    if [ "$from_step" -le 4 ]; then
        local app_path="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/Pronto.app"
        local dmg_filename="Pronto_${new_version}_aarch64.dmg"
        local dmg_path="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg/$dmg_filename"
        local dmg_dir="$(dirname "$dmg_path")"

        mkdir -p "$dmg_dir"

        if [[ "$completion_status" =~ 4 ]] && [ -z "$force_redo" ]; then
            log_info "Step 4/8: DMG already created, skipping..."
        else
            # Notarize the app
            log_info "Step 4/8: Notarizing app (this may take a few minutes)..."
            local zip_path=$(mktemp /tmp/Pronto-notarize.XXXXXX.zip)
            ditto -c -k --keepParent "$app_path" "$zip_path"

            if ! xcrun notarytool submit "$zip_path" \
                --apple-id "$APPLE_ID" \
                --password "$APPLE_PASSWORD" \
                --team-id "$APPLE_TEAM_ID" \
                --wait; then
                rm -f "$zip_path"
                log_error "Notarization failed"
                log_error "Resume with: $0 $new_version --force-from-step 4"
                exit 1
            fi
            rm -f "$zip_path"
            log_success "Notarization accepted"

            # Staple the notarization ticket
            log_info "Stapling notarization ticket..."
            xcrun stapler staple "$app_path"
            log_success "Stapled"

            # Create DMG
            log_info "Creating DMG..."
            rm -f "$dmg_path"
            if ! create-dmg \
                --volname "Pronto" \
                --no-internet-enable \
                --sandbox-safe \
                --icon-size 128 \
                --icon "Pronto.app" 130 150 \
                --app-drop-link 370 150 \
                "$dmg_path" \
                "$app_path"; then
                log_error "Failed to create DMG"
                log_error "Resume with: $0 $new_version --force-from-step 4"
                exit 1
            fi
            log_success "Created DMG: $dmg_filename"

            # Copy DMG to project root
            cp "$dmg_path" "$PROJECT_ROOT/$dmg_filename"
            log_success "Copied DMG to project root: $PROJECT_ROOT/$dmg_filename"
        fi
    fi

    # Set up DMG path for later steps
    local dmg_filename="Pronto_${new_version}_aarch64.dmg"
    local dmg_path="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg/$dmg_filename"

    # Step 5: Create git tag and push
    if [ "$from_step" -le 5 ]; then
        if [[ "$completion_status" =~ 5 ]] && [ -z "$force_redo" ]; then
            log_info "Step 5/8: Git tag already created, skipping..."
        else
            log_info "Step 5/8: Creating git tag and pushing..."
            git tag -a "v$new_version" -m "Release v$new_version" 2>/dev/null || log_warning "Tag v$new_version already exists"
            git push origin master
            git push origin "v$new_version" 2>/dev/null || log_warning "Tag push may have failed (already exists?)"
            log_success "Git changes pushed with tag"
        fi
    fi

    # Step 6: Create GitHub release
    if [ "$from_step" -le 6 ]; then
        if [[ "$completion_status" =~ 6 ]] && [ -z "$force_redo" ]; then
            log_info "Step 6/8: GitHub release already created, skipping..."
        else
            log_info "Step 6/8: Creating GitHub release..."
            if ! gh release create "v$new_version" "$dmg_path" \
                --title "Pronto v$new_version" \
                --notes "$release_notes" 2>/dev/null; then
                log_error "Failed to create GitHub release"
                log_error "Resume with: $0 $new_version --force-from-step 6"
                exit 1
            fi
            log_success "GitHub release created"
        fi
    fi

    # Get the release download URL
    local release_url="https://github.com/sandroguerreiro/pronto/releases/download/v$new_version/$dmg_filename"
    log_info "Release URL: $release_url"

    # Step 7: Calculate SHA256 of DMG
    if [ "$from_step" -le 7 ]; then
        log_info "Step 7/8: Calculating SHA256 hash..."
        local dmg_sha256=$(shasum -a 256 "$dmg_path" | awk '{print $1}')
        log_success "SHA256: $dmg_sha256"
    fi

    # Step 8: Update Homebrew tap
    if [ "$from_step" -le 8 ]; then
        log_info "Step 8/8: Updating Homebrew tap..."
        local dmg_sha256=$(shasum -a 256 "$dmg_path" | awk '{print $1}')
        update_homebrew_tap "$new_version" "$release_url" "$dmg_sha256" "$dmg_filename"
        log_success "Homebrew tap updated"
        log_success "Release $new_version completed successfully!"
    fi
}

# Update Homebrew tap
update_homebrew_tap() {
    local version=$1
    local url=$2
    local sha256=$3
    local dmg_filename=$4

    local temp_dir=$(mktemp -d)
    local cask_file="$temp_dir/Casks/${CASK_NAME}.rb"

    log_info "Cloning Homebrew tap..."
    git clone "$HOMEBREW_TAP_URL" "$temp_dir"

    # Generate new cask content
    log_info "Updating cask file..."
    cat > "$cask_file" << EOF
cask "${CASK_NAME}" do
  version "${version}"
  sha256 "${sha256}"

  url "${url}"
  name "Pronto"
  desc "Native macOS menu bar app for monitoring GitHub Pull Requests"
  homepage "https://github.com/sandroguerreiro/pronto"

  app "Pronto.app"

  zap trash: [
    "~/Library/Application Support/com.pronto.desktop",
    "~/Library/Caches/com.pronto.desktop",
    "~/Library/Preferences/com.pronto.desktop.plist",
  ]
end
EOF

    # Commit and push
    cd "$temp_dir"
    git config user.email "bot@pronto.local"
    git config user.name "Pronto Release Bot"
    git add "Casks/${CASK_NAME}.rb"
    git commit -m "Update Pronto cask to version $version"
    git push origin master

    log_success "Homebrew tap updated"

    # Clean up
    rm -rf "$temp_dir"
}

# Run main function
main "$@"
