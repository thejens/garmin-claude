# =============================================================================
# claude-code-tracker — Garmin activity tracker for Claude Code sessions
# =============================================================================

.PHONY: help \
        daemon-install daemon-dev daemon-build daemon-test daemon-typecheck \
        watch-key watch-build watch-sim watch-clean clean

.DEFAULT_GOAL := help

# Locate the latest installed Connect IQ SDK on macOS
CIQ_SDK_BIN := $(shell ls -d "$(HOME)/Library/Application Support/Garmin/ConnectIQ/Sdks"/connectiq-sdk-mac-*/bin 2>/dev/null | sort -V | tail -1)
MONKEYC  := $(CIQ_SDK_BIN)/monkeyc
MONKEYDO := $(CIQ_SDK_BIN)/monkeydo
CONNECTIQ := $(CIQ_SDK_BIN)/connectiq

DEVICE    ?= fr965
WATCH_PRG := watch/build/tracker-$(DEVICE).prg

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-25s\033[0m %s\n", $$1, $$2}'

# --- Daemon (Node / TypeScript) ---------------------------------------

daemon-install: ## Install daemon npm dependencies
	cd daemon && npm install

daemon-dev: ## Start daemon in dev mode (tsx, no compile step)
	cd daemon && npx tsx src/index.ts start

daemon-build: ## Compile daemon TypeScript → dist/
	cd daemon && npx tsc

daemon-test: ## Run daemon unit tests
	cd daemon && npx vitest run

daemon-typecheck: ## Type-check daemon without emitting
	cd daemon && npx tsc --noEmit

# --- Watch app (Connect IQ / Monkey C) --------------------------------

watch-key: ## Generate a Connect IQ developer signing key (one-time, gitignored)
	@if [ -f watch/developer_key ]; then \
	  echo "watch/developer_key already exists — nothing to do."; \
	else \
	  openssl genrsa -out /tmp/ciq_dev.pem 4096 && \
	  openssl pkcs8 -topk8 -inform PEM -outform DER \
	    -in /tmp/ciq_dev.pem -out watch/developer_key -nocrypt && \
	  rm /tmp/ciq_dev.pem && \
	  echo "Wrote watch/developer_key (gitignored)."; \
	fi

watch-build: ## Build the .prg (set DEVICE= to override; default: fr965)
	@if [ ! -f watch/source/Config.mc ]; then \
	  echo "Error: watch/source/Config.mc is missing."; \
	  echo "       Copy watch/source/Config.mc.example → Config.mc and fill in values."; \
	  exit 1; \
	fi
	mkdir -p watch/build
	"$(MONKEYC)" -d $(DEVICE) -f watch/monkey.jungle \
	  -o $(WATCH_PRG) -y watch/developer_key
	@echo "Built: $(WATCH_PRG)"

watch-sim: watch-build ## Build and run in the Connect IQ simulator
	@pgrep -f "ConnectIQ.app" > /dev/null || ("$(CONNECTIQ)" &)
	@echo "Waiting for simulator..." && sleep 4
	"$(MONKEYDO)" $(WATCH_PRG) $(DEVICE)

watch-clean: ## Remove watch build output
	rm -rf watch/build

# --- Cleanup ----------------------------------------------------------

clean: watch-clean ## Remove all generated artifacts
	rm -rf daemon/dist
