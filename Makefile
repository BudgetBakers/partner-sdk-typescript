.PHONY: lint test build

lint:
	npm run lint
	npx tsc --noEmit

test:
	npm test

build:
	npm run build
