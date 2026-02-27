# Fridge → Recipe → Bring! (GitHub Pages)

Client-side web app that:
1. Takes **multiple** fridge photos
2. Detects likely ingredients fully in-browser (TensorFlow.js + COCO-SSD)
3. Finds a dinner recipe (TheMealDB, no API key)
4. Computes missing ingredients
5. Tries to add missing items to Bring! (unofficial API)

## Key points

- Works on GitHub Pages (static hosting).
- No OpenAI key required for image detection/recipe lookup.
- Bring! integration is unofficial and may break anytime.
- Browser CORS may block Bring requests depending on their current policy.

## How detection works

- Uses COCO-SSD object detection in browser.
- Maps detected classes (e.g., `apple`, `banana`, `broccoli`) to ingredient names.
- Includes a custom produce mapping/alias layer (e.g., courgette → zucchini, aubergine → eggplant) to improve matching.
- Lets you manually edit the detected ingredient list before searching recipes.

## Run locally

Open `index.html` in a browser.

For camera capture on mobile, host over HTTPS (GitHub Pages already is HTTPS).

## Deploy to GitHub Pages

- Push this folder to a repo
- In GitHub: Settings → Pages → Deploy from branch (`main`, root)
