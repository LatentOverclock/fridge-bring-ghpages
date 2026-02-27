const $ = (id) => document.getElementById(id);

const state = {
  imageDataUrl: null,
  fridgeIngredients: [],
  recipe: null,
  missing: [],
};

function log(msg) {
  $("status").textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
}

function loadSettings() {
  ["openaiKey", "model", "bringEmail", "bringPassword", "bringListUuid"].forEach((k) => {
    const v = localStorage.getItem(`fridgeApp.${k}`);
    if (v) $(k).value = v;
  });
}

function saveSettings() {
  ["openaiKey", "model", "bringEmail", "bringPassword", "bringListUuid"].forEach((k) => {
    localStorage.setItem(`fridgeApp.${k}`, $(k).value.trim());
  });
  log("Settings saved.");
}

async function openAIJson({ system, user }) {
  const key = $("openaiKey").value.trim();
  if (!key) throw new Error("Missing OpenAI key.");

  const model = $("model").value.trim() || "gpt-4.1-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function analyzeFridge() {
  if (!state.imageDataUrl) return;
  log("Analyzing fridge image...");

  const key = $("openaiKey").value.trim();
  if (!key) throw new Error("Set OpenAI key first.");

  const model = $("model").value.trim() || "gpt-4.1-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You detect likely edible ingredients in fridge photos. Return strict JSON: {ingredients: string[]} using singular nouns and simple names. Keep confidence-safe guesses only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "List visible fridge ingredients." },
            { type: "image_url", image_url: { url: state.imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Vision error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  state.fridgeIngredients = (parsed.ingredients || []).map((s) => s.trim()).filter(Boolean);

  log(`Detected ${state.fridgeIngredients.length} ingredients: ${state.fridgeIngredients.join(", ") || "none"}`);
  $("findRecipeBtn").disabled = !state.fridgeIngredients.length;
}

async function findRecipe() {
  if (!state.fridgeIngredients.length) return;
  log("Finding recipe...");

  const parsed = await openAIJson({
    system:
      "You are a practical recipe planner. Return strict JSON: {title:string, servings:number, ingredients:[{name:string, amount:string}], instructions:string[], why_fit:string}",
    user: `Available ingredients: ${state.fridgeIngredients.join(", ")}.\nGoal: one good dinner recipe for tonight that uses as many available ingredients as possible while staying realistic.`,
  });

  state.recipe = parsed;
  $("recipe").textContent = JSON.stringify(parsed, null, 2);
  $("computeMissingBtn").disabled = false;
  log(`Recipe ready: ${parsed.title}`);
}

function normalize(s) {
  return s.toLowerCase().replace(/\(.+?\)/g, "").replace(/[^a-z0-9\s-]/g, "").trim();
}

function computeMissing() {
  if (!state.recipe?.ingredients) return;
  const have = new Set(state.fridgeIngredients.map(normalize));
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
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      state.imageDataUrl = reader.result;
      $("preview").src = state.imageDataUrl;
      $("preview").hidden = false;
      $("analyzeBtn").disabled = false;
      log("Photo loaded.");
    };
    reader.readAsDataURL(file);
  });

  $("analyzeBtn").addEventListener("click", () => analyzeFridge().catch((e) => log(`Error: ${e.message}`)));
  $("findRecipeBtn").addEventListener("click", () => findRecipe().catch((e) => log(`Error: ${e.message}`)));
  $("computeMissingBtn").addEventListener("click", () => computeMissing());
  $("addToBringBtn").addEventListener("click", () => addMissingToBring().catch((e) => log(`Bring Error: ${e.message}`)));
  $("copyBtn").addEventListener("click", copyMissing);
}

loadSettings();
bindEvents();
