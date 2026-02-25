# Release Process

This document outlines the process for creating and deploying new releases of the VC Deal Flow App.

## Version Numbering

We use **semantic versioning** (MAJOR.MINOR.PATCH):
- **MAJOR** (1.x.x): Breaking changes or major feature overhauls
- **MINOR** (x.1.x): New features, significant improvements
- **PATCH** (x.x.1): Bug fixes, minor improvements

Current version: **1.2.0**

## Release Workflow

### 1. Prepare the Release

Before creating a release, ensure all changes are tested and working:

```powershell
# Test locally
npm run dev

# Test the build
npm run build
npm start
```

### 2. Update Version and Changelog

**Update CHANGELOG.md:**

```markdown
## [1.1.0] - 2026-02-15

### Added
- New feature description

### Changed
- Modified feature description

### Fixed
- Bug fix description

### Removed
- Deprecated feature description
```

**Update package.json version:**

```powershell
# Manually edit package.json or use npm version
npm version minor  # For 1.0.0 -> 1.1.0
npm version patch  # For 1.0.0 -> 1.0.1
npm version major  # For 1.0.0 -> 2.0.0
```

**Update VersionFooter.tsx release date:**

Edit `components/VersionFooter.tsx` and update the `releaseDate` constant:

```typescript
const releaseDate = '2026-02-15'; // Update this with each release
```

### 3. Commit Changes

```powershell
git add CHANGELOG.md package.json components/VersionFooter.tsx
git commit -m "Release v1.1.0"
```

### 4. Create Git Tag

```powershell
# Create annotated tag
git tag -a v1.1.0 -m "Release v1.1.0

- Feature 1
- Feature 2
- Bug fix 1"

# Verify the tag
git tag -l -n9 v1.1.0
```

### 5. Push to Repository

```powershell
# Push commits
git push

# Push tags
git push --tags
```

### 6. Deploy to Production

```powershell
# Run the deployment script
.\scripts\deploy-cloudbuild.ps1
```

The script will:
- Display the version being deployed
- Build the Docker image in Google Cloud
- Deploy to Cloud Run
- Show the production URL
- Remind you to create a git tag (if not done already)

### 7. Verify Deployment

1. Visit the production URL: https://vc-deal-flow-prod-rqglurwb3a-uc.a.run.app
2. Log in with the team password
3. Check the version number in the footer
4. Test key features:
   - Dashboard loads correctly
   - Deals and Partners sync from HubSpot
   - Diligence module works (upload, score, chat)
   - Email generation functions

### 8. Notify Team

Send a message to the team with:
- Version number
- Release date
- Key changes (copy from CHANGELOG.md)
- Any action items or breaking changes

## Hotfix Process

For urgent bug fixes that need to be deployed immediately:

1. Create a hotfix branch (optional for small team):
   ```powershell
   git checkout -b hotfix/critical-bug
   ```

2. Make the fix and test thoroughly

3. Update CHANGELOG.md with a patch version:
   ```markdown
   ## [1.0.1] - 2026-02-05
   
   ### Fixed
   - Critical bug description
   ```

4. Update package.json version to patch (e.g., 1.0.0 -> 1.0.1)

5. Commit, tag, and deploy:
   ```powershell
   git commit -m "Hotfix v1.0.1: Fix critical bug"
   git tag -a v1.0.1 -m "Hotfix v1.0.1"
   git push && git push --tags
   .\scripts\deploy-cloudbuild.ps1
   ```

## Rollback Process

If a deployment has issues:

### Option 1: Quick Rollback via Cloud Run

```powershell
# List recent revisions
gcloud run revisions list --service=vc-deal-flow-prod --region=us-central1

# Rollback to previous revision
gcloud run services update-traffic vc-deal-flow-prod `
  --region=us-central1 `
  --to-revisions=PREVIOUS_REVISION_NAME=100
```

### Option 2: Deploy Previous Version

```powershell
# Checkout previous version tag
git checkout v1.0.0

# Deploy
.\scripts\deploy-cloudbuild.ps1

# Return to main branch
git checkout main
```

## Version History

View all releases:

```powershell
# List all tags
git tag -l

# Show tag details
git show v1.0.0

# View changelog
cat CHANGELOG.md
```

## Best Practices

1. **Test Before Release**: Always test locally and verify the build works
2. **Meaningful Commit Messages**: Write clear, descriptive commit messages
3. **Document Changes**: Keep CHANGELOG.md up to date with user-facing changes
4. **Tag Consistently**: Always create git tags for releases
5. **Verify Deployment**: Test the production deployment after each release
6. **Communicate**: Let the team know about new releases and changes
7. **Small, Frequent Releases**: Release often rather than accumulating many changes

## Troubleshooting

### Deployment Fails

1. Check Cloud Build logs:
   ```powershell
   # View recent builds
   gcloud builds list --limit=5
   
   # View specific build logs
   gcloud builds log BUILD_ID
   ```

2. Check Cloud Run logs:
   ```powershell
   gcloud run services logs read vc-deal-flow-prod --region=us-central1 --limit=50
   ```

### Version Not Updating in UI

1. Clear browser cache and hard reload (Ctrl+Shift+R)
2. Verify package.json version was updated
3. Check that VersionFooter.tsx is imported in DashboardLayout.tsx
4. Verify the build included the updated files

### Git Tag Issues

```powershell
# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin :refs/tags/v1.0.0

# Recreate tag
git tag -a v1.0.0 -m "Release v1.0.0"
git push --tags
```

## Questions?

For questions about the release process, contact the development team lead.
