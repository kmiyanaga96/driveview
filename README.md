# DriveView

Google Apps Script project managed with [clasp](https://github.com/google/clasp).

## Prerequisites

- Node.js >= 18
- npm
- Google account with Apps Script API enabled

## Setup

```bash
# Install dependencies
npm install

# Login to clasp (if not already)
clasp login

# Push code to GAS
npm run push
```

## Development

```bash
# Watch mode - auto-push on file changes
npm run watch

# Pull latest from GAS
npm run pull

# Open project in browser
npm run open

# View logs
npm run logs
```

## Deployment

```bash
# Create a new deployment
npm run deploy

# List versions
npm run versions
```

## Project Structure

```
driveview/
├── src/              # GAS source files (TypeScript)
│   └── appsscript.json  # GAS manifest
├── .clasp.json       # clasp project config
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```
