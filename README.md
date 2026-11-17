# ORBIT

ORBIT is a Flask-backed AI assistant with a static HTML/CSS/JavaScript frontend.

## Requirements

- Python 3.11 (recommended; Python 3.9+ is required by the `zoneinfo` module)
- One or more configured AI provider API keys
- Turso credentials for persistent hosted accounts and conversations

## Run locally

From the repository root:

```bash
cd Backend
python3.11 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env            # Windows: copy .env.example .env
python app.py
```

Open http://127.0.0.1:5000/ . Flask serves the frontend and API from the same origin.

For local frontend development using VS Code Live Server, serve the repository root on port 5500 or 5501. The shared `orbit-config.js` points API requests to the local Flask server.

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, create a Blueprint deployment using the root `render.yaml`.
3. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the ORBIT service.
4. Set at least one AI provider key (`NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, or `GROQ_API_KEY`).
5. Deploy. The service serves the website at `/` and health status at `/health`.

The backend intentionally refuses to start on Render without both Turso variables, preventing accidental use of ephemeral local storage for user accounts.

## API configuration

The frontend uses `orbit-config.js`. For a same-origin deployment it uses relative API paths. To host the frontend separately, set `window.ORBIT_API_BASE` before loading the page scripts, or configure the existing `ORBIT_FRONTEND_ORIGINS` environment variable on the backend to allow the frontend origin.

## Security

- Never commit `.env` files or API keys.
- Use HTTPS for hosted deployments.
- Keep Turso credentials and AI provider keys in the hosting provider's secret environment variables.
