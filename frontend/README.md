# Invoria Next.js Frontend

Modern React frontend for the existing Python/FastAPI backend.

## Stack

- Next.js (App Router)
- Tailwind CSS
- TradingView Lightweight Charts
- React Three Fiber (Three.js)

## Run

1. Start backend (FastAPI) on `http://localhost:8000`.
2. In this folder run:

```bash
npm install
npm run dev
```

To clean the build cache and restart development (recommended if build fails):

```bash
npm run clean-dev
```

Frontend runs on `http://localhost:3000` and fetches backend REST endpoints from `NEXT_PUBLIC_API_BASE_URL`.

Copy `.env.example` to `.env.local` if needed.
