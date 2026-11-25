"use strict";

// ---------- Cities we monitor ----------
const cities = [
  { name: "Manila", lat: 14.5995, lon: 120.9842 },
  { name: "Baguio City", lat: 16.4023, lon: 120.596 },
  { name: "Iloilo City", lat: 10.7202, lon: 122.5621 },
  { name: "Cebu City", lat: 10.3157, lon: 123.8854 },
  { name: "Tacloban City", lat: 11.2543, lon: 124.9631 },
  { name: "Davao City", lat: 7.1907, lon: 125.4553 },
  { name: "Zamboanga City", lat: 6.9214, lon: 122.079 },
  { name: "Cagayan de Oro", lat: 8.4542, lon: 124.6319 },
  { name: "Malaybalay", lat: 8.1575, lon: 125.1278 },
  { name: "Manolo Fortich", lat: 8.3694, lon: 124.8644 },
];

// ---------- Map ----------
const map = L.map("map").setView([11.2, 123.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// ---------- Page elements ----------
const apiKeyInput = document.getElementById("apiKey");
const startBtn = document.getElementById("startBtn");
// Named statusEl because window.status is already a browser property.
const statusEl = document.getElementById("status");
const weatherDetails = document.getElementById("weatherDetails");
const forecastEl = document.getElementById("forecast");
const cityList = document.getElementById("cityList");
const banner = document.getElementById("alertBanner");
const opacityInput = document.getElementById("opacity");
const opacityLabel = document.getElementById("opacityLabel");

// ---------- Settings and saved data ----------
const CACHE_MS = 10 * 60 * 1000; // keep results for 10 minutes
const REFRESH_MS = 10 * 60 * 1000; // check the cities again every 10 minutes

const cache = new Map(); // saved API results
const owmLayers = {}; // map layers from OpenWeather
const cityData = new Map(); // city name -> latest weather
const cityMarkers = new Map(); // city name -> marker on the map

let layerOpacity = Number(opacityInput.value) / 100;
let activeKey = ""; // the API key the layers were made with
let activeRequest = 0; // used to ignore old answers
let selectedPlace = null;
let selectedMarker = null;
let timerStarted = false;

// ---------- Small helper functions ----------
function setStatus(message) {
  statusEl.textContent = message;
}

function textElement(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

// Rain in the last hour (mm). Not every answer has this field.
function rainAmount(data) {
  if (data.rain && data.rain["1h"]) return data.rain["1h"];
  return 0;
}

function isRaining(data) {
  const type = data.weather[0].main;
  const rainyTypes = ["Rain", "Drizzle", "Thunderstorm"];
  return rainyTypes.includes(type) || rainAmount(data) > 0;
}

function formatTime(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------- Getting data from OpenWeather ----------
// endpoint is "weather" (right now) or "forecast" (every 3 hours)
async function requestWeather(endpoint, place) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) throw new Error("Enter your OpenWeather API key first.");

  // If we asked for the same thing less than 10 minutes ago, reuse it.
  const cacheId = `${endpoint}|${place.lat.toFixed(3)},${place.lon.toFixed(3)}|${apiKey}`;
  const saved = cache.get(cacheId);
  if (saved && Date.now() - saved.time < CACHE_MS) return saved.data;

  const url = new URL(`https://api.openweathermap.org/data/2.5/${endpoint}`);
  url.searchParams.set("lat", place.lat);
  url.searchParams.set("lon", place.lon);
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", apiKey);

  const response = await fetch(url);

  if (response.status === 401) {
    throw new Error("Invalid API key. New keys can take a while to activate.");
  }
  if (response.status === 429) {
    throw new Error("Too many requests. Please wait a bit and try again.");
  }
  if (!response.ok) {
    throw new Error(`Weather request failed (HTTP ${response.status}).`);
  }

  const data = await response.json();
  cache.set(cacheId, { data, time: Date.now() });
  return data;
}

// ---------- Map layers (rainfall, clouds, ...) ----------
function getOwmLayer(name) {
  if (!owmLayers[name]) {
    owmLayers[name] = L.tileLayer(
      `https://tile.openweathermap.org/map/${name}/{z}/{x}/{y}.png?appid=${activeKey}`,
      { opacity: layerOpacity, maxZoom: 19, zIndex: 5 }
    );
  }
  return owmLayers[name];
}

function clearOwmLayers() {
  Object.keys(owmLayers).forEach((name) => {
    map.removeLayer(owmLayers[name]);
    delete owmLayers[name];
  });
}

// Show the layers that are checked and hide the others.
function syncLayers() {
  if (!activeKey) return;

  document.querySelectorAll('input[name="layer"]').forEach((box) => {
    const layer = getOwmLayer(box.value);
    if (box.checked && !map.hasLayer(layer)) layer.addTo(map);
    if (!box.checked && map.hasLayer(layer)) map.removeLayer(layer);
  });
}

document.querySelectorAll('input[name="layer"]').forEach((box) => {
  box.addEventListener("change", syncLayers);
});

opacityInput.addEventListener("input", () => {
  layerOpacity = Number(opacityInput.value) / 100;
  opacityLabel.textContent = `${opacityInput.value}%`;
  Object.values(owmLayers).forEach((layer) => layer.setOpacity(layerOpacity));
});

// ---------- Showing the weather of one place ----------
function weatherView(placeName, data) {
  const card = document.createElement("div");
  card.className = "weather-card";

  const description = data.weather[0].description;

  const image = document.createElement("img");
  image.src = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
  image.alt = description;
  card.append(image);

  const info = document.createElement("div");
  info.append(textElement("strong", placeName));
  info.append(textElement("div", description, "description"));
  info.append(textElement("div", `${data.main.temp.toFixed(1)} °C`, "temperature"));
  info.append(textElement("div", `Feels like: ${data.main.feels_like.toFixed(1)} °C`));
  info.append(textElement("div", `Humidity: ${data.main.humidity}%`));
  info.append(textElement("div", `Wind: ${data.wind.speed} m/s`));
  info.append(textElement("div", `Rain (last hour): ${rainAmount(data).toFixed(1)} mm`));
  card.append(info);
  return card;
}

function renderForecast(forecast) {
  forecastEl.replaceChildren();

  // Each item is 3 hours, so 8 items = the next 24 hours.
  forecast.list.slice(0, 8).forEach((item) => {
    const card = document.createElement("div");
    card.className = "fc-card";
    card.append(textElement("div", formatTime(item.dt)));

    const image = document.createElement("img");
    image.src = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;
    image.alt = item.weather[0].description;
    card.append(image);

    const chance = Math.round((item.pop || 0) * 100);
    card.append(textElement("div", `${Math.round(item.main.temp)} °C`, "fc-temp"));
    card.append(textElement("div", `💧 ${chance}%`, "fc-pop"));

    if (item.rain && item.rain["3h"] > 0) {
      card.append(textElement("div", `${item.rain["3h"].toFixed(1)} mm`));
    }

    forecastEl.append(card);
  });
}

function updateAlert(placeName, current, forecast) {
  // "Rain likely" means 50% chance or more in the next 9 hours.
  const soon = forecast.list.slice(0, 3).find((item) => item.pop >= 0.5);
  let type;
  let message;

  if (isRaining(current)) {
    const mm = rainAmount(current);
    type = "alert-rain";
    message = `🌧️ It is raining in ${placeName}.`;
    if (mm > 0) message += ` (${mm.toFixed(1)} mm in the last hour)`;
  } else if (soon) {
    type = "alert-warn";
    message = `⚠️ Rain is likely in ${placeName} around ${formatTime(soon.dt)} (${Math.round(soon.pop * 100)}% chance).`;
  } else {
    type = "alert-clear";
    message = `✅ No rain right now in ${placeName}.`;
  }

  banner.className = `alert ${type}`;
  banner.textContent = message;
  banner.hidden = false;
}

// Change the header color to match the weather.
function applyTheme(current) {
  const type = current.weather[0].main;
  let theme = "mist";

  if (type === "Thunderstorm") theme = "storm";
  else if (type === "Rain" || type === "Drizzle") theme = "rain";
  else if (type === "Clear") theme = "clear";
  else if (type === "Clouds") theme = "clouds";

  document.body.className = `theme-${theme}`;
}

async function showWeather(place, silent) {
  const requestId = ++activeRequest;
  selectedPlace = place;
  if (!silent) setStatus(`Loading weather for ${place.name}...`);

  try {
    const current = await requestWeather("weather", place);
    const forecast = await requestWeather("forecast", place);
    if (requestId !== activeRequest) return; // a newer click happened

    // For a clicked point, use the place name that OpenWeather gives us.
    let name = place.name;
    if (place.custom && current.name) name = current.name;

    weatherDetails.replaceChildren(weatherView(name, current));
    renderForecast(forecast);
    updateAlert(name, current, forecast);
    applyTheme(current);
    setStatus(`Showing current weather for ${name}.`);
  } catch (error) {
    if (requestId !== activeRequest) return;

    weatherDetails.replaceChildren(textElement("div", "Could not load weather data."));
    forecastEl.replaceChildren(textElement("div", "Forecast unavailable."));
    banner.hidden = true;
    setStatus(error.message || "Something went wrong. Try again.");
  }
}

// ---------- City markers and city list ----------
// Blue = raining, gray = no rain, light gray = not checked yet.
function markerColors(data) {
  if (!data) return { color: "#7d8a99", fillColor: "#dfe5ec" };
  if (isRaining(data)) return { color: "#1b5cc0", fillColor: "#2f80ed" };
  return { color: "#7d8a99", fillColor: "#b8c2cc" };
}

function statusText(data) {
  if (!data) return "Not checked yet";
  return isRaining(data) ? "Raining" : "No rain";
}

// One clickable marker for each city.
cities.forEach((city) => {
  const marker = L.circleMarker([city.lat, city.lon], {
    radius: 11,
    weight: 3,
    fillOpacity: 0.9,
    bubblingMouseEvents: false, // so a marker click is not also a map click
  }).addTo(map);

  marker.setStyle(markerColors(null));
  marker.bindTooltip(`${city.name}: ${statusText(null)}`);
  marker.on("click", () => showWeather(city));
  cityMarkers.set(city.name, marker);
});

function updateMarkers() {
  cities.forEach((city) => {
    const data = cityData.get(city.name);
    const marker = cityMarkers.get(city.name);
    marker.setStyle(markerColors(data));
    marker.setTooltipContent(`${city.name}: ${statusText(data)}`);
  });
}

function renderCityList() {
  cityList.replaceChildren();

  cities.forEach((city) => {
    const data = cityData.get(city.name);
    const raining = data && isRaining(data);

    const button = textElement("button", city.name, "city-btn");
    button.type = "button";
    button.addEventListener("click", () => {
      map.setView([city.lat, city.lon], 9);
      showWeather(city);
    });

    let badgeText = "…";
    if (data) badgeText = raining ? "🌧️ Raining" : "☀️ No rain";
    const badge = textElement("span", badgeText, raining ? "badge rain" : "badge");

    const item = document.createElement("li");
    item.append(button, badge);
    cityList.append(item);
  });
}

// Get the weather of one city. Returns null if OK, or the error if it failed.
async function loadCity(city) {
  try {
    const data = await requestWeather("weather", city);
    cityData.set(city.name, data);
    return null;
  } catch (error) {
    return error;
  }
}

async function refreshAllCities() {
  setStatus("Checking rainfall in all cities...");

  const results = await Promise.all(cities.map(loadCity));
  const errors = results.filter((result) => result !== null);

  renderCityList();
  updateMarkers();

  // If every city failed, the problem is probably the API key.
  if (errors.length === cities.length) {
    setStatus(errors[0].message || "Could not load weather data.");
    return;
  }

  let rainingCount = 0;
  cityData.forEach((data) => {
    if (isRaining(data)) rainingCount++;
  });

  let message = "No rain detected in the monitored cities right now.";
  if (rainingCount > 0) {
    message = `Rain detected in ${rainingCount} of ${cities.length} cities.`;
  }
  if (errors.length > 0) message += " (Some cities could not be loaded.)";
  setStatus(message);
}

// ---------- Start monitoring ----------
async function startMonitoring() {
  const key = apiKeyInput.value.trim();
  if (key === "") {
    setStatus("Enter your OpenWeather API key first.");
    return;
  }

  // A new key means we must rebuild the layers and forget the old results.
  if (key !== activeKey) {
    clearOwmLayers();
    cityData.clear();
    activeKey = key;
  }

  startBtn.disabled = true; // stops fast double clicks (API limit)
  syncLayers();
  await refreshAllCities();
  startBtn.disabled = false;

  // Check again every 10 minutes (only start this timer once).
  if (!timerStarted) {
    timerStarted = true;
    setInterval(() => {
      refreshAllCities();
      if (selectedPlace) showWeather(selectedPlace, true);
    }, REFRESH_MS);
  }
}

startBtn.addEventListener("click", startMonitoring);
apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") startMonitoring();
});

// ---------- Click anywhere on the map ----------
map.on("click", (event) => {
  const point = event.latlng.wrap();
  const place = { name: "Selected location", lat: point.lat, lon: point.lng, custom: true };

  if (selectedMarker) {
    selectedMarker.setLatLng([place.lat, place.lon]);
  } else {
    selectedMarker = L.marker([place.lat, place.lon]).addTo(map);
  }
  showWeather(place);
});

// ---------- Start up ----------
renderCityList();

// Zoom the map so all the city markers can be seen.
map.fitBounds(
  cities.map((city) => [city.lat, city.lon]),
  { padding: [30, 30] }
);