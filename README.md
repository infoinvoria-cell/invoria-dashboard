
## Trading Dashboard

React frontend (Next.js) + Python backend (FastAPI).

### Architecture
- Frontend: `frontend/` (Next.js + Tailwind + React components)
- Backend API: `backend/` (FastAPI endpoints)
- ASGI entrypoint: `api.py`

### Run backend
```powershell
.\run_backend_api.ps1 -Port 8000
```

Or directly:
```bash
uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

### Run frontend
```powershell
.\run_dashboard.ps1 -ApiPort 8000 -FrontendPort 3000
```

Or directly:
```bash
cd frontend
npm install
npm run dev -- --port 3000
```

### Clean rebuild (recommended during development)
```powershell
cd frontend
npm run clean-dev
```

### Combined launcher (desktop‑style window)
```powershell
.\launch_dashboard_app.ps1 -ApiPort 8000 -FrontendPort 3000 -OpenWindow
```

### Desktop shortcut (creates an icon on your desktop)
```powershell
.\scripts\create-shortcut.ps1
```

### Network access (other devices on your LAN)
Run the dashboard binding to all network interfaces and open a browser window that points to your machine IP:
```powershell
.\scripts\start-dashboard.ps1 -ApiHost 0.0.0.0 -FrontendHost 0.0.0.0
```

Then open in another machine: `http://<YOUR_MACHINE_IP>:3000`

> Tip: If CORS blocks access from other devices, enable it in the backend by setting the environment variable:
> - `IVQ_ALLOW_ALL_ORIGINS=true`

### API endpoints used by frontend
- `/api/crosspairs`
- `/api/dollar-index`
- `/api/globe-assets`
- `/api/news`
- `/api/usd-news`
- `/api/seasonality`
- `/api/valuation10`
- `/api/valuation20`
- `/api/heatmap`
- `/api/weather-signal`
- `/api/macro-overlay`

### Deploy to a free public domain (Vercel)
1. Push your repository to GitHub.
2. Sign in to https://vercel.com and import the repo.
3. Configure the project to use the `frontend/` folder as the root.
4. Set the build command to:
   ```sh
   npm install && npm run build
   ```
5. Set the output directory to `.next` (default for Next.js).

Your public URL will look like `https://<your-project>.vercel.app`.

📌 **Note:** The frontend expects the backend API to be reachable at `NEXT_PUBLIC_API_BASE_URL`. When deploying, you need to host the Python backend somewhere (or point to a public API) and set that URL in Vercel environment variables.

# invoria-dashboard

