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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    local missing_tools=()

    # Check for required tools
    for tool in git gh pnpm cargo hdiutil; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done

    if [ ${#missing_tools[@]} -gt 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        exit 1
    fi

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

# Main release function
main() {
    if [ $# -lt 2 ]; then
        echo "Usage: $0 <version> <release-notes>"
        echo "Example: $0 0.4.3 'Fix: improved PR detection'"
        exit 1
    fi

    local new_version=$1
    local release_notes=$2

    # Validate version format
    validate_version "$new_version"

    # Check prerequisites
    check_prerequisites

    # Check git state
    check_git_state

    cd "$PROJECT_ROOT"

    # Get current version from package.json
    local current_version=$(grep '"version"' package.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')
    log_info "Current version: $current_version"
    log_info "New version: $new_version"
    log_info "Release notes: $release_notes"

    read -p "Press Enter to continue with the release, or Ctrl+C to cancel..."

    # Step 1: Bump versions
    log_info "Step 1/8: Bumping versions..."
    bump_version_in_file "$PROJECT_ROOT/package.json" "$current_version" "$new_version"
    bump_version_in_file "$PROJECT_ROOT/src-tauri/tauri.conf.json" "$current_version" "$new_version"
    bump_version_in_file "$PROJECT_ROOT/src-tauri/Cargo.toml" "$current_version" "$new_version"

    # Step 2: Commit version bump
    log_info "Step 2/8: Committing version bump..."
    git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
    git commit -m "Bump version to $new_version"
    log_success "Version bump committed"

    # Step 3: Build Tauri app
    log_info "Step 3/8: Building Tauri app..."

    # Build app bundle only (DMG will be created manually with hdiutil for better compatibility)
    if ! pnpm tauri build --bundles app; then
        log_error "Build failed"
        exit 1
    fi

    log_success "Build completed"

    # Step 4: Create DMG file manually
    log_info "Step 4/8: Creating DMG with hdiutil..."
    local app_path="$PROJECT_ROOT/src-tauri/target/release/bundle/macos/Pronto.app"
    local dmg_filename="Pronto_${new_version}_aarch64.dmg"
    local dmg_path="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg/$dmg_filename"
    local dmg_dir="$(dirname "$dmg_path")"

    # Create DMG directory if it doesn't exist
    mkdir -p "$dmg_dir"

    # Create DMG using hdiutil
    if ! hdiutil create -volname "Pronto" -srcfolder "$app_path" -ov -format UDZO "$dmg_path" > /dev/null 2>&1; then
        log_error "Failed to create DMG"
        exit 1
    fi

    log_success "Created DMG: $dmg_filename"

    # Step 5: Create git tag and push
    log_info "Step 5/8: Creating git tag and pushing..."
    git tag -a "v$new_version" -m "Release v$new_version"
    git push origin master
    git push origin "v$new_version"
    log_success "Git changes pushed with tag"

    # Step 6: Create GitHub release
    log_info "Step 6/8: Creating GitHub release..."
    gh release create "v$new_version" "$dmg_path" \
        --title "Pronto v$new_version" \
        --notes "$release_notes"
    log_success "GitHub release created"

    # Get the release download URL
    local release_url="https://github.com/sandroguerreiro/pronto/releases/download/v$new_version/$dmg_filename"
    log_info "Release URL: $release_url"

    # Step 7: Calculate SHA256 of DMG
    log_info "Step 7/8: Calculating SHA256 hash..."
    local dmg_sha256=$(shasum -a 256 "$dmg_path" | awk '{print $1}')
    log_success "SHA256: $dmg_sha256"

    # Step 8: Update Homebrew tap
    log_info "Step 8/8: Updating Homebrew tap..."
    update_homebrew_tap "$new_version" "$release_url" "$dmg_sha256" "$dmg_filename"

    log_success "Release $new_version completed successfully!"
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
