# Spade / tui-pilot — developer shortcuts.
#
#   make dev      start the server with auto-reload (recommended)
#   make run      start the server without reload
#   make setup    create the venv (uv) and install dependencies
#   make test     run the test suite
#   make stop     stop a running server
#   make open     open the UI in your browser
#   make fresh    wipe the data dir (asks to confirm)
#
# Override any variable, e.g.:  make dev PORT=9000 DATA_HOME=~/my-spade

HOST      ?= 127.0.0.1
PORT      ?= 8765
DATA_HOME ?= $(HOME)/spade-qa
VENV      ?= .venv
PY        := $(VENV)/bin/python
RUN_ENV    = TUI_PILOT_HOME=$(DATA_HOME) TUI_PILOT_API_BASE=http://$(HOST):$(PORT)

.DEFAULT_GOAL := help
.PHONY: help dev run setup test stop open fresh

help:
	@echo "Spade / tui-pilot — make targets"
	@echo "  make dev      start the server with auto-reload  → http://$(HOST):$(PORT)/ui/"
	@echo "  make run      start the server (no reload)"
	@echo "  make setup    create the venv (uv) + install deps"
	@echo "  make test     run the test suite"
	@echo "  make stop     stop a running server"
	@echo "  make open     open the UI in your browser"
	@echo "  make fresh    wipe the data dir (asks to confirm)"
	@echo ""
	@echo "  data home: $(DATA_HOME)   (override: make dev DATA_HOME=~/other PORT=9000)"

# Build the venv on demand (used as a prerequisite by dev/run/test).
$(VENV):
	@$(MAKE) setup

setup:
	@command -v uv >/dev/null 2>&1 || { echo "uv not found — install: https://docs.astral.sh/uv/"; exit 1; }
	@test -d $(VENV) || uv venv $(VENV)
	@uv pip install --python $(PY) -r requirements.txt
	@echo "✓ setup complete — run 'make dev'"

dev: $(VENV) stop
	@echo "▶ Spade dev server  →  http://$(HOST):$(PORT)/ui/   (data: $(DATA_HOME), auto-reload ON)"
	@$(RUN_ENV) $(PY) -m uvicorn tui_pilot.server:app --reload --host $(HOST) --port $(PORT)

run: $(VENV) stop
	@echo "▶ Spade server  →  http://$(HOST):$(PORT)/ui/   (data: $(DATA_HOME))"
	@$(RUN_ENV) $(PY) -m uvicorn tui_pilot.server:app --host $(HOST) --port $(PORT)

test: $(VENV)
	@$(PY) -m pytest -q

stop:
	@pkill -f "uvicorn tui_pilot.server:app" 2>/dev/null && echo "• stopped running server" || true

open:
	@open "http://$(HOST):$(PORT)/ui/" 2>/dev/null || echo "open http://$(HOST):$(PORT)/ui/"

fresh:
	@echo "⚠ This deletes $(DATA_HOME) — all projects, accounts, tasks, brain, pipelines."
	@read -p "Type 'yes' to confirm: " c && [ "$$c" = "yes" ] && rm -rf "$(DATA_HOME)" && echo "wiped $(DATA_HOME)" || echo "cancelled"
