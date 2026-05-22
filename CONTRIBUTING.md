# Contributing to can-see

Thanks for your interest in contributing!

## Setup

```bash
git clone https://github.com/HurleySk/can-see.git
cd can-see
npm install
npm run build
```

### Prerequisites

Native dependencies ([node-canvas](https://github.com/nickg/node-canvas) and [node-pty](https://github.com/nickg/node-pty)) require a C++ toolchain:

- **Windows:** Visual Studio Build Tools (C++ workload)
- **macOS:** `xcode-select --install`
- **Linux:** `sudo apt install build-essential libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev`

## Running Tests

```bash
npm test
```

All tests must pass before submitting a PR. `AttachConsole failed` warnings in test output are harmless node-pty noise on Windows.

## Submitting Changes

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Add or update tests as needed
4. Run `npm test` and ensure everything passes
5. Open a PR against `master`

## Code Style

- TypeScript, ESM modules
- Tests use vitest
- `@xterm/headless` is CJS — see `CLAUDE.md` for the import pattern
