#!/usr/bin/env bash
#
# Has a later build of the same trigger already started?
#
# Prints that build's commit to stdout if so, nothing if not. Diagnostics go
# to stderr, so stdout carries the answer and nothing else -- folding the two
# together is what made a gcloud warning read as a commit once already.
#
#   exit 0, stdout empty      nothing later has started
#   exit 0, stdout has a sha  that commit's build started after this one
#   exit 1                    could not find out; the caller decides
#
# Two pushes close together start two builds, and whichever finishes last
# wins regardless of which commit is newer. That happened: the build of
# 56689f5 started 12 seconds before the build of its own child 5f5156f and
# finished 36 seconds after it, putting the older image into production.
#
# This asks Cloud Build rather than GitHub on purpose. The first version read
# main's tip with a personal access token; when that token stopped
# authenticating the guard silently did nothing. Here the only caller is the
# build's own service account asking about its own project.

set -euo pipefail

build_id="${1:-}"
if [ -z "$build_id" ]; then
  echo "usage: later-build.sh <build-id>" >&2
  exit 2
fi

# Which trigger started this build, and when? Both come from one lookup whose
# exit code is checked, because an empty trigger is meaningful -- it means
# "started by hand". Reading it with a second, unchecked call once made a
# transient API error look like a manual build, which deployed unguarded.
own=""
answered=""
for attempt in 1 2 3; do
  if own=$(gcloud builds describe "$build_id" --region=global \
             --format='value[separator="|"](buildTriggerId,createTime)' 2>/dev/null); then
    answered=yes
    break
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "Could not read this build's own record (attempt $attempt of 3); retrying." >&2
    sleep $((attempt * 5))
  fi
done

if [ -z "$answered" ]; then
  echo "Three attempts to read this build's own record all failed." >&2
  exit 1
fi

# The record must be one line of exactly two fields, each looking like what it
# claims to be. Checking only that a separator appeared was close to cosmetic:
# a malformed value still splits into a plausible-looking pair, and a trigger
# id that is well formed but wrong just returns an empty list, which reads as
# "nothing later". Noise must not be able to wear the shape of data.
if [ "$(printf '%s' "$own" | wc -l)" != "0" ]; then
  echo "This build's record spans more than one line." >&2
  exit 1
fi

if [ "$(printf '%s' "$own" | tr -cd '|' | wc -c)" != "1" ]; then
  echo "This build's record did not come back as exactly two fields." >&2
  exit 1
fi

trigger=$(printf '%s' "$own" | cut -d'|' -f1)
mine=$(printf '%s' "$own" | cut -d'|' -f2)

if [ -n "$trigger" ] && ! printf '%s' "$trigger" | grep -qE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
  echo "This build's trigger id is not a trigger id." >&2
  exit 1
fi

if ! printf '%s' "$mine" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9][0-9:.]*Z$'; then
  echo "This build's start time is missing or not a timestamp." >&2
  exit 1
fi

# No trigger means it was started by hand, so nothing can have overtaken it.
# That is also the way out if this check ever blocks a deploy wrongly.
if [ -z "$trigger" ]; then
  echo "Started by hand rather than by a push, so nothing can have overtaken it." >&2
  exit 0
fi

# Status is filtered after the query, not in --filter: putting it there makes
# gcloud report that no key matched and return nothing, which would read as
# "nothing later" and defeat the check. stderr is kept out of the parsed value
# for the same reason -- on an empty result gcloud warns there and exits 0.
errfile=$(mktemp)
if ! later=$(gcloud builds list --region=global \
               --filter="buildTriggerId=$trigger AND createTime>\"$mine\"" \
               --format='value(status,substitutions.COMMIT_SHA)' 2>"$errfile"); then
  echo "Could not list this trigger's builds." >&2
  cat "$errfile" >&2
  rm -f "$errfile"
  exit 1
fi
rm -f "$errfile"

# The excluded statuses are the ones meaning a build will never deploy.
# Anything else -- including a status not named here -- counts as live, so an
# unfamiliar state makes the caller hold rather than race. Holding leaves
# production on older code, which is recoverable; racing moves it backwards.
# Only a real commit sha counts, so stray output cannot pass for a reason.
printf '%s\n' "$later" \
  | grep -v -E '^(FAILURE|CANCELLED|TIMEOUT|INTERNAL_ERROR|EXPIRED)' \
  | cut -f2 \
  | grep -E '^[0-9a-f]{40}$' \
  | head -1 || true
