#!/bin/bash

set -euo pipefail

jj git fetch --remote gitlab-origin

jj new main@gitlab-origin
# Copy current state of main
jj restore --from main
jj desc -m 'deploy: sync squashed commits from github'

git push gitlab-origin "$(jj log -r @ --no-graph -T commit_id)":refs/heads/main
jj git fetch --remote gitlab-origin

# Back to main!
jj new main
