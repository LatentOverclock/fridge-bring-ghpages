const $ = (id) => document.getElementById(id);

const state = {
  imageDataUrls: [],
  fridgeIngredients: [],
  recipe: null,
  missing: [],
  model: null,
};

const FOOD_CLASS_MAP = {
  banana: ["banana"],
  apple: ["apple"],
  orange: ["orange"],
  broccoli: ["broccoli"],
  carrot: ["carrot"],
  sandwich: ["bread", "cheese", "ham"],
  pizza: ["pizza"],
  donut: ["donut"],
  cake: ["cake"],
  hotdog: ["sausage", "bun"],
  "hot dog": ["sausage", "bun"],
  bottle: ["bottle"],
  bowl: ["bowl"],
  cup: ["cup"],
  "wine glass": ["wine"],
};

function log(msg) {
  $("status").textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\(.+?\)/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim();
}

function unique(arr) {
  return [...new Set(arr.map((x) => normalize(x)).filter(Boolean))];
}

function loadSettings() {
  ["bringEmail", "bringPassword", "bringListUuid"].forEach((k) => {
    const v = localStorage.getItem(`fridgeApp.${k}`);
    if (v) $(k).value = v;
  });
}

function saveSettings() {
  ["bringEmail", "bringPassword", "bringListUuid"].forEach((k) => {
    localStorage.setItem(`fridgeApp.${k}`, $(k).value.trim());
  });
  log("Settings saved.");
}

function renderPreviews() {
  const grid = $("previewGrid");
  grid.innerHTML = "";
  for (const url of state.imageDataUrls) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Fridge preview";
    img.className = "preview-thumb";
    grid.appendChild(img);
  }
}

function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function ensureModel() {
  if (state.model) return state.model;
  if (!window.cocoSsd) throw new Error("COCO-SSD library not loaded.");
  log("Loading browser ML model (first run can take a bit)...");
  state.model = await window.cocoSsd.load({ base: "lite_mobilenet_v2" });
  return state.model;
}

function ingredientsFromPredictions(predictions) {
  const out = [];
  for (const p of predictions) {
    if ((p.score || 0) < 0.4) continue;
    const label = normalize(p.class);
    const mapped = FOOD_CLASS_MAP[label];
    if (mapped) out.push(...mapped);
  }
  return out;
}

async function analyzeFridge() {
  if (!state.imageDataUrls.length) return;

  const model = await ensureModel();
  const allIngredients = [];

  log(`Analyzing ${state.imageDataUrls.length} image(s)...`);
  for (let i = 0; i < state.imageDataUrls.length; i++) {
    const img = await dataUrlToImage(state.imageDataUrls[i]);
    const predictions = await model.detect(img, 20);
    allIngredients.push(...ingredientsFromPredictions(predictions));
    log(`Analyzed image ${i + 1}/${state.imageDataUrls.length}`);
  }

  state.fridgeIngredients = unique(allIngredients);
  $("ingredientsInput").value = state.fridgeIngredients.join(", ");
  $("findRecipeBtn").disabled = !state.fridgeIngredients.length;

  log(
    `Detected ${state.fridgeIngredients.length} ingredient(s): ${
      state.fridgeIngredients.join(", ") || "none"
    }`
  );
}

function getIngredientsFromInput() {
  const raw = $("ingredientsInput").value;
  state.fridgeIngredients = unique(raw.split(/[\n,]/g).map((s) => s.trim()));
  return state.fridgeIngredients;
}

async function fetchMealIdsForIngredient(ingredient) {
  const res = await fetch(
    `https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ingredient)}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.meals || []).map((m) => m.idMeal);
}

async function fetchMealDetails(idMeal) {
  const res = await fetch(`https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(idMeal)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.meals?.[0] || null;
}

function mealToRecipe(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] || "").trim();
    const amount = (meal[`strMeasure${i}`] || "").trim();
    if (name) ingredients.push({ name, amount });
  }

  const instructions = (meal.strInstructions || "")
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    title: meal.strMeal,
    servings: 2,
    ingredients,
    instructions,
    why_fit: "Selected from recipes matching your detected fridge ingredients.",
    source_url: meal.strSource || meal.strYoutube || "",
  };
}

function scoreMeal(recipe, haveIngredients) {
  const have = new Set(haveIngredients.map(normalize));
  let overlap = 0;
  for (const item of recipe.ingredients) {
    if (have.has(normalize(item.name))) overlap += 1;
  }
  return overlap;
}

async function findRecipe() {
  const ingredients = getIngredientsFromInput();
  if (!ingredients.length) throw new Error("No ingredients found. Add or edit detected ingredients first.");

  log("Searching recipe candidates...");

  const topIngredients = ingredients.slice(0, 6);
  const idLists = await Promise.all(topIngredients.map(fetchMealIdsForIngredient));
  const idSet = new Set(idLists.flat().filter(Boolean));

  if (!idSet.size) throw new Error("No recipes found from detected ingredients.");

  const candidateIds = [...idSet].slice(0, 20);
  const meals = (await Promise.all(candidateIds.map(fetchMealDetails))).filter(Boolean);
  if (!meals.length) throw new Error("Could not load recipe details.");

  const recipes = meals.map(mealToRecipe);
  recipes.sort((a, b) => scoreMeal(b, ingredients) - scoreMeal(a, ingredients));

  state.recipe = recipes[0];
  $("recipe").textContent = JSON.stringify(state.recipe, null, 2);
  $("computeMissingBtn").disabled = false;
  log(`Recipe ready: ${state.recipe.title}`);
}

function computeMissing() {
  if (!state.recipe?.ingredients) return;
  const have = new Set(getIngredientsFromInput().map(normalize));
  state.missing = state.recipe.ingredients.filter((i) => !have.has(normalize(i.name)));

  const ul = $("missingList");
  ul.innerHTML = "";
  for (const i of state.missing) {
    const li = document.createElement("li");
    li.textContent = `${i.name}${i.amount ? ` — ${i.amount}` : ""}`;
    ul.appendChild(li);
  }

  $("addToBringBtn").disabled = !state.missing.length;
  $("copyBtn").disabled = !state.missing.length;
  log(`Missing items: ${state.missing.length}`);
}

async function bringLogin() {
  const email = $("bringEmail").value.trim();
  const password = $("bringPassword").value.trim();
  if (!email || !password) throw new Error("Bring credentials missing.");

  const res = await fetch("https://api.getbring.com/rest/v2/bringauth", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ email, password, client: "webApp" }).toString(),
  });

  if (!res.ok) throw new Error(`Bring auth failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function addMissingToBring() {
  const listUuid = $("bringListUuid").value.trim();
  if (!listUuid) throw new Error("Bring list UUID missing.");
  if (!state.missing.length) throw new Error("No missing items.");

  log("Logging into Bring...");
  const auth = await bringLogin();

  const headers = {
    "X-BRING-API-KEY": "android",
    "X-BRING-USER-UUID": auth.uuid,
    "X-BRING-TOKEN": auth.access_token,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };

  for (const item of state.missing) {
    const body = new URLSearchParams({
      purchase: item.name,
      specification: item.amount || "",
      remove: "false",
    }).toString();

    const res = await fetch(`https://api.getbring.com/rest/v2/bringlists/${listUuid}`, {
      method: "PUT",
      headers,
      body,
    });

    if (!res.ok) throw new Error(`Bring add failed for ${item.name}: ${res.status} ${await res.text()}`);
  }

  log(`Added ${state.missing.length} items to Bring.`);
}

function copyMissing() {
  const text = state.missing.map((i) => `- ${i.name}${i.amount ? ` (${i.amount})` : ""}`).join("\n");
  navigator.clipboard.writeText(text);
  log("Missing list copied.");
}

function bindEvents() {
  $("saveSettings").addEventListener("click", saveSettings);

  $("photoInput").addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;

    const urls = await Promise.all(
      files.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );

    state.imageDataUrls = urls;
    renderPreviews();
    $("analyzeBtn").disabled = false;
    log(`${urls.length} photo(s) loaded.`);
  });

  $("analyzeBtn").addEventListener("click", () => analyzeFridge().catch((e) => log(`Error: ${e.message}`)));
  $("findRecipeBtn").addEventListener("click", () => findRecipe().catch((e) => log(`Error: ${e.message}`)));
  $("computeMissingBtn").addEventListener("click", () => computeMissing());
  $("addToBringBtn").addEventListener("click", () => addMissingToBring().catch((e) => log(`Bring Error: ${e.message}`)));
  $("copyBtn").addEventListener("click", copyMissing);
}

loadSettings();
bindEvents();
