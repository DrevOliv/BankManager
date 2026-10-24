# BankManager: build, publish and run the Docker image.
#
#   make build          Build drevoliv/bankmanager for this machine and load it into Docker
#   make push           Build for linux/amd64 + linux/arm64 and push drevoliv/bankmanager:latest
#   make push 1.2.0     Push drevoliv/bankmanager:1.2.0 and :latest
#   make push someone/bankmanager:1.2.0   Use another image name
#
# Variables work too: make push IMAGE=drevoliv/bankmanager TAG=1.2.0

IMAGE     ?= drevoliv/bankmanager
TAG       ?= latest
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER   ?= bankmanager-builder

COMMANDS := help build push builder up down logs test

# Accept an image name and/or tag as a plain word after the command (make push 1.2.0,
# make build someone/bankmanager:dev), and turn that word into a no-op target so make
# doesn't try to build a file with that name. A word without "/" or ":" is just a tag.
EXTRA := $(filter-out $(COMMANDS),$(MAKECMDGOALS))
ifneq ($(EXTRA),)
  WORD := $(firstword $(EXTRA))
  ifneq ($(findstring /,$(WORD))$(findstring :,$(WORD)),)
    IMAGE := $(WORD)
  else
    TAG := $(WORD)
  endif
  $(eval $(subst :,\:,$(EXTRA)):;@:)
endif

# drevoliv/bankmanager:1.2.0 → IMAGE=drevoliv/bankmanager TAG=1.2.0
ifneq ($(findstring :,$(IMAGE)),)
  TAG := $(word 2,$(subst :, ,$(IMAGE)))
  IMAGE := $(word 1,$(subst :, ,$(IMAGE)))
endif

# A versioned build is also tagged "latest".
TAGS := -t $(IMAGE):$(TAG)
ifneq ($(TAG),latest)
  TAGS += -t $(IMAGE):latest
endif

BUILD_ARGS := --build-arg VERSION=$(TAG) $(TAGS)

.DEFAULT_GOAL := help
.PHONY: $(COMMANDS)

help: ## Show this help
	@echo "Usage: make <command> [tag | image[:tag]]    (image defaults to $(IMAGE))"
	@echo
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN { FS = ":.*## " } { printf "  make %-8s %s\n", $$1, $$2 }'
	@echo
	@echo "Examples:"
	@echo "  make build                  builds $(IMAGE):latest"
	@echo "  make push 1.0.0             pushes $(IMAGE):1.0.0 and :latest"
	@echo "  make push someone/app:dev   another image name"

build: ## Build the image for this machine and load it into Docker
	docker buildx build --load $(BUILD_ARGS) .
	@echo
	@echo "Built $(IMAGE):$(TAG)"

push: builder ## Build for amd64 and arm64 and push to Docker Hub (run docker login first)
	@case "$(IMAGE)" in */*) ;; *) echo "Give the image your Docker Hub name, e.g. make push yourname/bankmanager"; exit 1;; esac
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) --push $(BUILD_ARGS) .
	@echo
	@echo "Pushed $(IMAGE):$(TAG) for $(PLATFORMS)"

builder: ## Create the multi-platform buildx builder (done automatically by push)
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 || docker buildx create --name $(BUILDER) --driver docker-container --bootstrap

up: ## Build from source and start the app with Docker Compose
	docker compose up -d --build

down: ## Stop the app (your data stays in the Docker volume)
	docker compose down

logs: ## Follow the app logs
	docker compose logs -f app

test: ## Run the server tests (set TEST_DATABASE_URL to also run the API test)
	cd server && npm test
