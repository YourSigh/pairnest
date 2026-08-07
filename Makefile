-include .env

PAIRNEST_API_IMAGE ?= pairnest-api:0.1-local
PAIRNEST_PLATFORM ?= linux/amd64

.PHONY: build-api publish-api

build-api:
	docker build --platform $(PAIRNEST_PLATFORM) \
		-f server/Dockerfile \
		-t $(PAIRNEST_API_IMAGE) \
		server

publish-api:
	docker buildx build --platform $(PAIRNEST_PLATFORM) \
		-f server/Dockerfile \
		-t $(PAIRNEST_API_IMAGE) \
		--push \
		server
