#!/bin/bash

set -euo pipefail

# GitLab's main is a separate squashed history, so local main must not track it.
jj bookmark untrack main@gitlab-origin 2>/dev/null || true

jj git fetch --remote gitlab-origin

rev() { jj log -r "$1" --no-graph -T commit_id; }
tree="$(rev main)^{tree}"
parent="$(rev main@gitlab-origin)"

if [ "$(git rev-parse "$tree")" = "$(git rev-parse "$parent^{tree}")" ]; then
    echo "GitLab is already up to date with main."
    exit 0
fi

# Build the deploy commit with git directly so the working copy is untouched.
commit=$(git commit-tree "$tree" -p "$parent" -m 'deploy: sync squashed commits from github')

git push gitlab-origin "$commit":refs/heads/main
jj git fetch --remote gitlab-origin
