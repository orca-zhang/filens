# Fictional writing project. Recipes use literal tab characters.
PYTHON ?= python3
NOTES_DIR := journal
OUTPUT_DIR := exports

.PHONY: help inventory check serve

help:
	@printf 'inventory  List manuscript files\n'
	@printf 'check      Validate the collection index\n'
	@printf 'serve      Open a local reading copy on port 8080\n'

inventory:
	@find "$(NOTES_DIR)" -type f -name '*.md' -print | sort

check:
	$(PYTHON) -m json.tool preview.json > /dev/null

serve:
	$(PYTHON) -m http.server 8080 --bind 127.0.0.1 --directory "$(OUTPUT_DIR)"
