#!/bin/sh
set -eu
cd "$(dirname "$0")"

IMAGES="python:bogey-runner-python:3.13 node:bogey-runner-node:22 gcc:bogey-runner-gcc:14 java:bogey-runner-java:21 kotlin:bogey-runner-kotlin:2.1 rust:bogey-runner-rust:1.85 go:bogey-runner-go:1.24"

mode=build
if [ "${1:-}" = "pull" ]; then mode=pull; shift; fi

for entry in $IMAGES; do
  dir="${entry%%:*}"
  tag="${entry#*:}"
  if [ "$#" -gt 0 ]; then
    case " $* " in *" $dir "*) ;; *) continue ;; esac
  fi
  if [ "$mode" = "pull" ]; then
    docker pull "ghcr.io/0xethen/$tag"
    docker tag "ghcr.io/0xethen/$tag" "$tag"
  else
    docker build -t "$tag" "$dir"
  fi
done
