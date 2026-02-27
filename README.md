# Fridge → Recipe → Bring! (GitHub Pages)

Client-side web app that:
1. Takes a fridge photo
2. Detects ingredients with OpenAI vision
3. Picks an evening recipe
4. Computes missing ingredients
5. Tries to add missing items to Bring! (unofficial API)

## Important caveats

- This is **frontend-only** (GitHub Pages compatible).
- API keys/credentials are stored in `localStorage` on the same browser profile.
- Bring! uses an unofficial API and may break anytime.
- Browser CORS may block Bring requests depending on their current policy.

## Run locally

Just open `index.html` in a browser.

For camera capture on mobile, host over HTTPS (GitHub Pages is HTTPS by default).

## Deploy to GitHub Pages

- Push this folder to a repo.
- In GitHub: Settings → Pages → Deploy from branch (root).

## Suggested hardening (optional)

If you want this to be robust, keep UI on Pages but move integrations to a tiny backend:
- OpenAI calls from backend (protect key)
- Bring auth/calls from backend (avoid CORS and login leakage)
