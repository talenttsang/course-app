#!/bin/sh
#
# Did an earlier step mark this build as overtaken?
#
#   exit 0  a marker written by this pipeline is present
#   exit 1  no marker
#
# Every step asks this one question, because they do not all run in the same
# image and they used to disagree about what a marker is. A committed symlink
# pointing at a path that exists only inside the node image was dangling in
# the cloud-sdk steps and resolved in the node ones, so the checks skipped
# themselves while the deploy went ahead -- green, with the gate bypassed.
#
# Only a regular file counts. A symlink is rejected however it resolves, so
# the answer cannot depend on which image is asking.
m=/workspace/.superseded
[ -f "$m" ] && [ ! -L "$m" ]
