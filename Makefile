SHELL := /bin/bash

.SILENT:
.DEFAULT_GOAL := help

include .env
export

VERSION  = $(shell node -p "require('./package.json').version")
XPI      = web-ext-artifacts/simple_workspaces-$(VERSION).zip
ADDON_ID = simple-workspaces@jaehho
FF_PROF  = $(shell find ~/.config/mozilla/firefox ~/.mozilla/firefox -maxdepth 1 -name '*.dev-edition-default' -type d 2>/dev/null | head -1)

## General
help: ## Show this help message
	echo "Available targets:"
	echo "=================="
	grep -hE '(^[a-zA-Z_%-]+:.*?## .*$$|^## )' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; \
		     /^## / {gsub("^## ", ""); print "\n\033[1;35m" $$0 "\033[0m"}; \
		     /^[a-zA-Z_%-]+:/ {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

## Development
dev: ## Run extension in Firefox with hot reload
	npx web-ext run --source-dir src --firefox=firefox-developer-edition

dev-android: ## Run extension on Firefox Android with hot reload
	npx web-ext run --source-dir src --target=firefox-android

lint: ## Run all linters
	npx web-ext lint --source-dir src
	npx eslint src/

## Publishing
publish: bump build install sign ## Bump version, build, install locally, and submit to AMO

bump: ## Bump patch version in package.json and manifest.json
	npm version patch --no-git-tag-version
	node -e "\
		const m=JSON.parse(require('fs').readFileSync('src/manifest.json','utf8'));\
		m.version=require('./package.json').version;\
		require('fs').writeFileSync('src/manifest.json',JSON.stringify(m,null,2)+'\n')"
	@echo "Bumped to $$(node -p "require('./package.json').version")"

build: ## Build .xpi artifact
	npx web-ext build --source-dir src --overwrite-dest

sign: ## Submit to AMO for signing
	npx web-ext sign --source-dir src --channel listed --amo-metadata amo-metadata.json

sign-self: bump ## Sign for self-install (no AMO review)
	npx web-ext sign --source-dir src --channel unlisted

install: ## Install .xpi into Firefox Dev Edition profile (restart Firefox to load)
	@test -n "$(FF_PROF)" || { echo "Error: no dev-edition-default profile found"; exit 1; }
	mkdir -p "$(FF_PROF)/extensions"
	cp $(XPI) "$(FF_PROF)/extensions/$(ADDON_ID).xpi"
	@echo "Installed to $(FF_PROF)/extensions/$(ADDON_ID).xpi"
	@echo "Firefox killed. Reopen to load the update."
	kill $$(pidof firefox) 2>/dev/null || true

## Maintenance
clean: ## Remove build artifacts
	rm -rf web-ext-artifacts
