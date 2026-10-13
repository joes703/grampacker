#!/usr/bin/env bash
# Pushes an image that scripts/check-image.sh has already passed, and prints
# its registry digest. Used by .github/workflows/image.yml; the caller has
# already logged Docker in to the registry.
#
#   scripts/publish-image.sh <local image> <repository> <full commit SHA>
#   scripts/publish-image.sh grampacker:check ghcr.io/joes703/grampacker "$GITHUB_SHA"
#
# The tag is the full commit SHA, and this never replaces it: if the tag
# already exists, it refuses and prints the digest the tag points to. A
# rebuild of the same commit is not byte-identical, so replacing the tag
# would make one commit name two images. The check comes before the push and
# is not atomic: another writer could create the tag in between. The
# workflow runs one publish at a time, and a deployment uses the digest,
# never the tag.
#
# After the push it reads the image back from the registry BY DIGEST and
# checks that it is the image that was tested and that it is linux/amd64.
#
# Needs Docker with buildx and jq. In GitHub Actions it also writes the digest
# to the job summary and to the step outputs `digest` and `image`.
set -euo pipefail

LOCAL="${1:?usage: scripts/publish-image.sh <local image> <repository> <full commit SHA>}"
REPO="${2:?usage: scripts/publish-image.sh <local image> <repository> <full commit SHA>}"
SHA="${3:?usage: scripts/publish-image.sh <local image> <repository> <full commit SHA>}"

fail() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail "not a full commit SHA: $SHA"
# Registry repositories are lowercase; refuse a tag or digest in the name.
[[ "$REPO" =~ ^[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9._-]+)+$ ]] || fail "not a repository name: $REPO"

REF="$REPO:$SHA"
tested_id="$(docker image inspect -f '{{.Id}}' "$LOCAL")"

# Only buildx's own "<ref>: not found", for exactly this reference, means
# the tag is free. Any other error (network, authentication, a 404 from
# somewhere else) stops here rather than pushing blind.
set +e
existing="$(docker buildx imagetools inspect --format '{{json .Manifest}}' "$REF" 2>&1)"
code=$?
set -e
if [ "$code" = 0 ]; then
  fail "$REF already exists ($(jq -r .digest <<<"$existing")). This script never replaces a tag; deploy that digest only if a run for this commit succeeded."
fi
[ "$existing" = "ERROR: $REF: not found" ] || fail "could not check whether $REF exists: $existing"

docker tag "$LOCAL" "$REF"
docker push "$REF"

# The digest the registry serves for the tag, read back from the registry.
digest="$(docker buildx imagetools inspect --format '{{json .Manifest}}' "$REF" | jq -r .digest)"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "registry returned no digest for $REF: $digest"
PINNED="$REPO@$digest"

# Read back from the registry by digest, not from the local image store
# (which already holds the image, so a pull would prove nothing): it is one
# linux/amd64 image, and it is the one that was tested. Docker's local image
# ID is the manifest digest (containerd image store) or the config digest
# (classic store), so it must equal one of them.
manifest="$(docker buildx imagetools inspect --raw "$PINNED")"
media="$(jq -r .mediaType <<<"$manifest")"
[ "$media" = application/vnd.oci.image.manifest.v1+json ] ||
  [ "$media" = application/vnd.docker.distribution.manifest.v2+json ] ||
  fail "$PINNED is $media, expected a single-platform image manifest"
config="$(jq -r .config.digest <<<"$manifest")"
platform="$(docker buildx imagetools inspect --format '{{json .Image}}' "$PINNED" | jq -r '.os + "/" + .architecture')"
[ "$platform" = linux/amd64 ] || fail "$PINNED is $platform, expected linux/amd64"
[ "$tested_id" = "$digest" ] || [ "$tested_id" = "$config" ] ||
  fail "$PINNED (config $config) is not the tested image $tested_id"

echo "published $REF"
echo "digest    $digest"
echo "image     $PINNED"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "digest=$digest"; echo "image=$PINNED"; } >>"$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Published image"
    echo ""
    echo "| | |"
    echo "| --- | --- |"
    echo "| Commit | \`$SHA\` |"
    echo "| Tag | \`$REF\` |"
    echo "| Digest | \`$digest\` |"
    echo "| Deploy this | \`$PINNED\` |"
    echo ""
    echo "Checked: the registry serves this digest as one linux/amd64 image, the one scripts/check-image.sh passed."
  } >>"$GITHUB_STEP_SUMMARY"
fi
