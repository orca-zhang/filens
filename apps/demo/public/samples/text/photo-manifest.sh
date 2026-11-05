#!/usr/bin/env bash
# Print a sorted photo inventory without changing the source files.
set -euo pipefail

photo_dir="."
if [[ "$#" -gt 0 ]]; then photo_dir="$1"; fi
if [[ ! -d "$photo_dir" ]]; then
  printf 'Photo directory not found: %s\n' "$photo_dir" >&2
  exit 1
fi

printf 'PHOTO INVENTORY\nDirectory: %s\n\n' "$photo_dir"
find "$photo_dir" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print |
  LC_ALL=C sort | while IFS= read -r file; do
    printf '%s\n' "$file"
  done
printf '\nEnd of inventory.\n'
