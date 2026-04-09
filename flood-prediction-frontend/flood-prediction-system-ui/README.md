# Flood Prediction System (Frontend)

React + Vite + Tailwind frontend for a **Flood Prediction System** with:

- Dashboard (weather + rainfall chart + risk summary)
- Flood Map (Leaflet + risk overlays)
- Weather page
- Reports page (filters + CSV/Excel/PDF export + “Send to Power BI” simulation)
- Settings (admin-only)
- Profile
- Role-based UI via **mock JWT** stored in localStorage

## Run locally

```bash
npm install
npm run dev
```

Open the app, go to `/login`, pick a role:
- **user**: Dashboard / Flood Map / Weather
- **expert**: adds Reports
- **admin**: adds Settings (and all pages)

## API endpoints used

- `GET /api/weather`
- `GET /api/flood-prediction`
- `GET /api/reports?date=YYYY-MM-DD&district=...`
- `POST /api/export-powerbi`

## Dev mocks

By default the UI runs with a dev mock layer (see `VITE_USE_MOCKS=true` in `.env`) so you can use the full app without a backend.

To use a real backend, set the API base URL in **Settings** (admin role) or disable mocks:

```bash
VITE_USE_MOCKS=false
```

