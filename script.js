/**
 * ==============================================================================
 * PROJECT SKYSENTRY (PHASE 1: SUVARNABHUMI PILOT)
 * Master Client-Side GIS Weather Radar & Ground-Truth Calibration Engine
 * 
 * Mobile-First Responsive & Collapsible Tactical HUD Edition
 * Target Area  : Bang Kruai, Nonthaburi, Thailand [13.8050, 100.4728]
 * Data Sources : RainViewer API (Radar HD Tiles) & Open-Meteo (Live Weather & Forecast)
 * Backend      : Google Apps Script Webhook -> Google Sheets (SkySentry_GroundTruth_DB)
 * ==============================================================================
 */

// --- 1. CORE CONSTANTS & CONFIGURATION ---
const DEFAULT_COORDS = [13.8050, 100.4728]; // [Latitude, Longitude] for Bang Kruai, Nonthaburi
const DEFAULT_STATION_NAME = "บางกรวย, นนทบุรี (Bang Kruai)";
const INITIAL_ZOOM = 10;
const RADAR_OPACITY_DEFAULT = 0.80; // Default to 80% opacity for vivid radar echoes
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzE6_RZmqcjo8JOVRwzXSh09A3XwcFnu5RejLJdD0RatP5brSs2eCafcYb6NhDW1RvR3Q/exec";

// 3-Tier Tactical Playback Speeds (🐢 0.5x, 🚶 1x, ⚡ 2x)
const PLAYBACK_SPEEDS = [
  { key: 'slow',   label: "🐢 0.5x", shortLabel: "0.5x", interval: 1200, crossfadeSec: "0.32s" },
  { key: 'normal', label: "🚶 1x",   shortLabel: "1x",   interval: 600,  crossfadeSec: "0.24s" },
  { key: 'fast',   label: "⚡ 2x",   shortLabel: "2x",   interval: 300,  crossfadeSec: "0.18s" }
];
let currentSpeedIndex = 1; // Default to Level 2: "🚶 1x" (600ms)

// Application Active State (Persistent Home Location Support)
// Feature 5: Default to saved Home coordinates ({lat, lon}) or fallback to Bang Kruai [13.8050, 100.4728]
const savedHomeStr = localStorage.getItem('skysentry_home') || localStorage.getItem('skysentry_home_coords');
const savedHomeName = localStorage.getItem('skysentry_home_name');
let initialCoords = [...DEFAULT_COORDS];
let initialStationName = DEFAULT_STATION_NAME;

if (savedHomeStr) {
  try {
    const parsed = JSON.parse(savedHomeStr);
    if (parsed && typeof parsed.lat === 'number' && typeof parsed.lon === 'number' && !isNaN(parsed.lat) && !isNaN(parsed.lon)) {
      initialCoords = [parsed.lat, parsed.lon];
      initialStationName = savedHomeName || `บ้านของคุณ [${parsed.lat.toFixed(4)}, ${parsed.lon.toFixed(4)}]`;
    } else if (Array.isArray(parsed) && parsed.length === 2 && !isNaN(parsed[0]) && !isNaN(parsed[1])) {
      initialCoords = [parsed[0], parsed[1]];
      initialStationName = savedHomeName || "ตำแหน่งบ้านของคุณ";
    }
  } catch (e) {
    console.warn('Error reading saved home coords:', e);
  }
}

let currentCoords = [...initialCoords];
let currentStationName = initialStationName;
let apiData = null;                    // RainViewer API response
let radarFrames = [];                  // Chronological radar frames array (Past + Nowcast)
let currentFrameIndex = -1;            // Active radar frame index
let currentLiveFrameIndex = -1;        // Boundary index between past and future nowcast (Current Time T0)
let liveT0Index = -1;                  // Alias boundary index for Nowcast timeline
let animationTimer = null;             // Interval ID for playback loop
let isPlaying = false;                 // Playback active flag
let isLooping = true;                  // Playback loop active flag
let radarOpacity = RADAR_OPACITY_DEFAULT;
let activeWeatherSummary = "28.5°C, ความชื้น 80%, ลม 12.0 km/h, โอกาสฝน 40%";
let currentPredictedEta = null;        // Active Date instance for Predicted Rain ETA
let currentTheme = localStorage.getItem('skysentry_theme') || 'light';

// Web Audio API Tactical Chime Synthesizer (Feature 7)
let audioCtx = null;
let lastChimeTriggerTime = 0;
let previousAlertState = 'normal';

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// User-gesture unlock for AudioContext
['click', 'touchstart', 'keydown'].forEach(evt => {
  document.addEventListener(evt, () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }, { once: false, passive: true });
});

/**
 * Synthesizes a clean tactical alert chime (Dual-tone Sine/Triangle)
 * Triggered when a Red Storm Warning (🔴) is triggered.
 */
function playTacticalWarningChime() {
  const nowMs = Date.now();
  if (nowMs - lastChimeTriggerTime < 8000) return; // Prevent chime spam
  lastChimeTriggerTime = nowMs;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Tactical warning tone 1 (880 Hz -> 1320 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, t);
    osc1.frequency.exponentialRampToValueAtTime(1320, t + 0.12);

    gain1.gain.setValueAtTime(0.001, t);
    gain1.gain.linearRampToValueAtTime(0.28, t + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.18);

    // Tactical warning tone 2 (1760 Hz with pulse warble)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1760, t + 0.14);
    osc2.frequency.exponentialRampToValueAtTime(987.77, t + 0.32);

    gain2.gain.setValueAtTime(0.001, t + 0.14);
    gain2.gain.linearRampToValueAtTime(0.22, t + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.36);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t + 0.14);
    osc2.stop(t + 0.38);

    // Tactical confirmation beep (1760 Hz)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1760, t + 0.42);

    gain3.gain.setValueAtTime(0.001, t + 0.42);
    gain3.gain.linearRampToValueAtTime(0.25, t + 0.44);
    gain3.gain.exponentialRampToValueAtTime(0.001, t + 0.62);

    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(t + 0.42);
    osc3.stop(t + 0.65);
  } catch (err) {
    console.warn('Web Audio synthesis error:', err);
  }
}

// Dual-Layer Radar Crossfade Interpolation State (Pure GPU Compositing)
let radarLayerA = null;
let radarLayerB = null;
let activeLayerRole = 'A'; // Alternates between 'A' and 'B'

// Tactical Storm Tracker & ETA State (Phase 2)
let stormCentroidCache = {};           // Keyed by frame.path => { lat, lng, time, maxDbz, count, distToHome }
let stormTrajectoryLine = null;        // Leaflet polyline for projected 1-hour storm movement
let stormInterceptCone = null;         // Leaflet polygon for predicted intercept uncertainty cone (+60m)
let stormCentroidMarker = null;        // Leaflet marker for isolated storm center
let stormInterceptMarker = null;       // Leaflet marker for projected intercept point at 5 km boundary
let latestStormTrackingData = null;    // Active tracking telemetry (speed, bearing, etc.)
let latestWind850 = { speed: 12, dir: 220 }; // Tropospheric 850 hPa steering fallback
let stormTrackerDebounceTimer = null;  // Debounce timer for offscreen canvas analysis

// Range Rings & Markers Group (Lag-Free Native SVG Renderer)
let centerMarker = null;
let rangeSvgRenderer = null;
let rangeRingsGroup = null;
let map = null;
let osmBaseLayer = null;

// Initial theme styling (UI skin only)
if (currentTheme === 'light') {
  document.body.classList.add('light-theme');
  document.body.classList.remove('dark-theme');
} else {
  document.body.classList.remove('light-theme');
  document.body.classList.add('dark-theme');
}

/**
 * Ensures Leaflet library (L) is fully loaded before initializing map.
 * Handles CodePen asynchronous execution and CDN network latency gracefully.
 */
function ensureLeafletLoaded(callback) {
  if (typeof L !== 'undefined') {
    callback();
    return;
  }

  // Ensure leaflet.css is in document head (essential in CodePen)
  if (!document.querySelector('link[href*="leaflet"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }

  // Ensure leaflet.js script tag is injected if missing
  let script = document.querySelector('script[src*="leaflet"]');
  if (!script) {
    script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    document.head.appendChild(script);
  }

  const checkTimer = setInterval(() => {
    if (typeof L !== 'undefined') {
      clearInterval(checkTimer);
      callback();
    }
  }, 25);
}

/**
 * Initializes Leaflet Map, Panes, Base Tiles, and Tactical Listeners safely.
 */
function initLeafletMap() {
  if (map || typeof L === 'undefined') return;

  rangeSvgRenderer = L.svg({ padding: 0.5 });
  rangeRingsGroup = L.layerGroup();

  map = L.map('map', {
    center: currentCoords,
    zoom: INITIAL_ZOOM,
    minZoom: 4,
    maxZoom: 14,
    zoomControl: false
  });

  rangeRingsGroup.addTo(map);

  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  map.createPane('radarPane');
  map.getPane('radarPane').style.zIndex = 450;
  map.getPane('radarPane').style.pointerEvents = 'none';

  map.createPane('labelsPane');
  map.getPane('labelsPane').style.zIndex = 650;
  map.getPane('labelsPane').style.pointerEvents = 'none';

  osmBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors | Radar &copy; <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
    maxZoom: 19,
    subdomains: ['a', 'b', 'c']
  }).addTo(map);

  map.on('zoomend', updateZoomBadge);
  updateZoomBadge();

  map.on('click', openRainInspector);
  map.on('moveend', () => scheduleStormTrackerAnalysis(currentFrameIndex));

  updateRadarRangeRings(currentCoords);
  initWindArrowMarker(currentCoords);
}

// --- 3. TACTICAL RANGE RINGS & CENTER BEACON (LAG-FREE ZOOM ENGINE) ---
function updateRadarRangeRings(latLng) {
  // Clear previous vector layers efficiently
  rangeRingsGroup.clearLayers();

  // Tactical Threat Level Color Hierarchy: 5KM (Critical Red) -> 10KM (Warning Amber) -> 20KM (Perimeter Green, Clean Ring)
  const ringSpecs = [
    {
      radiusMeters: 5000,
      label: "5 KM RANGE",
      strokeColor: "#ef4444",
      strokeOpacity: 0.85,
      weight: 2,
      dashArray: "5, 5",
      fillColor: "#ef4444",
      fillOpacity: 0.05,
      angleDeg: 0,
      badgeClass: "pill-critical",
      ringClass: "tactical-ring ring-critical",
      showBadge: true
    },
    {
      radiusMeters: 10000,
      label: "10 KM RANGE",
      strokeColor: "#eab308",
      strokeOpacity: 0.8,
      weight: 1.8,
      dashArray: "5, 5",
      fillColor: "#eab308",
      fillOpacity: 0.03,
      angleDeg: 25,
      badgeClass: "pill-warning",
      ringClass: "tactical-ring ring-warning",
      showBadge: true
    },
    {
      radiusMeters: 20000,
      label: "20 KM TACTICAL PERIMETER",
      strokeColor: "#22c55e",
      strokeOpacity: 0.75,
      weight: 1.6,
      dashArray: "5, 5",
      fillColor: "#22c55e",
      fillOpacity: 0.015,
      angleDeg: 40, // Positioned at top-right along circle perimeter, aligned in sequence with 5KM (0°) and 10KM (25°)
      badgeClass: "pill-perimeter",
      ringClass: "tactical-ring ring-perimeter",
      showBadge: true
    }
  ];

  ringSpecs.forEach(spec => {
    // Native Leaflet Circle with dedicated SVG renderer for instantaneous GPU-assisted zoom scaling
    const circle = L.circle(latLng, {
      radius: spec.radiusMeters,
      color: spec.strokeColor,
      opacity: spec.strokeOpacity,
      weight: spec.weight,
      dashArray: spec.dashArray,
      fillColor: spec.fillColor,
      fillOpacity: spec.fillOpacity,
      className: spec.ringClass,
      renderer: rangeSvgRenderer,
      interactive: false
    });
    rangeRingsGroup.addLayer(circle);

    if (spec.showBadge && spec.label) {
      // Calculate position along circle perimeter at angleDeg to prevent overlap
      const rad = (spec.angleDeg * Math.PI) / 180;
      const latDist = spec.radiusMeters * Math.cos(rad);
      const lonDist = spec.radiusMeters * Math.sin(rad);

      const latOffset = latDist / 111320;
      const lonOffset = lonDist / (111320 * Math.cos((latLng[0] * Math.PI) / 180));
      const badgePos = [latLng[0] + latOffset, latLng[1] + lonOffset];

      const badgeWidth = spec.radiusMeters === 20000 ? 210 : 120;
      const badgeIcon = L.divIcon({
        className: 'range-label-icon',
        html: `<div class="range-ring-pill ${spec.badgeClass}">${spec.label}</div>`,
        iconSize: [badgeWidth, 26],
        iconAnchor: [badgeWidth / 2, 13]
      });

      const badgeMarker = L.marker(badgePos, { icon: badgeIcon, interactive: false });
      rangeRingsGroup.addLayer(badgeMarker);
    }
  });

  const pulseIcon = L.divIcon({
    className: 'tactical-marker-icon',
    html: `
      <div class="tactical-marker-wrap">
        <div class="marker-pulse-ring"></div>
        <div class="marker-core-dot"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  centerMarker = L.marker(latLng, { icon: pulseIcon });
  centerMarker.bindPopup(`
    <div style="font-family:'Chakra Petch', sans-serif; font-size:12px; color:#0f172a;">
      <b style="color:#0284c7;">🎯 ${currentStationName}</b><br>
      <span style="font-family:'JetBrains Mono', monospace; font-size:11px;">พิกัด: ${latLng[0].toFixed(4)}°N, ${latLng[1].toFixed(4)}°E</span><br>
      <span>รัศมีเรดาร์ปฏิบัติการ: 20 กม.</span>
    </div>
  `);
  rangeRingsGroup.addLayer(centerMarker);
}

// --- 4. DOM ELEMENTS CACHE ---
// Desktop Header & Panels
const headerPanel = document.getElementById('headerPanel');
const leftPanelToggleBtn = document.getElementById('leftPanelToggleBtn');
const weatherPanel = document.getElementById('weatherPanel');
const rightPanelToggleBtn = document.getElementById('rightPanelToggleBtn');
const playbackPanel = document.getElementById('playbackPanel');
const playbackPanelToggleBtn = document.getElementById('playbackPanelToggleBtn');
const collapsedWeatherChip = document.getElementById('collapsedWeatherChip');
const weatherPillTrigger = document.getElementById('weatherPillTrigger');
const pillTemp = document.getElementById('pillTemp');
const pillHumidity = document.getElementById('pillHumidity');
const hudSettingsBtn = document.getElementById('hudSettingsBtn');
const hudSettingsMenu = document.getElementById('hudSettingsMenu');

const zoomBadge = document.getElementById('zoomBadge');
const coordsDisplay = document.getElementById('coordsDisplay');
const coordsDisplayLat = document.getElementById('coordsDisplayLat');
const coordsDisplayLon = document.getElementById('coordsDisplayLon');
const stationNameDisplay = document.getElementById('stationNameDisplay');
const locateBtn = document.getElementById('locateBtn');
const resetLocationBtn = document.getElementById('resetLocationBtn');
const customPinBtn = document.getElementById('customPinBtn');
const setHomeBtn = document.getElementById('setHomeBtn');

// Hourly & 7-Day Outlook Modal Elements
const hourlyForecastContainer = document.getElementById('hourlyForecastContainer');
const open7DayModalBtn = document.getElementById('open7DayModalBtn');
const sevenDayModalBackdrop = document.getElementById('sevenDayModalBackdrop');
const close7DayModalBtn = document.getElementById('close7DayModalBtn');
const modal7DayCardsContainer = document.getElementById('modal7DayCardsContainer');

// Theme Switcher Controls
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const themeText = document.getElementById('themeText');
const mobileThemeToggleBtn = document.getElementById('mobileThemeToggleBtn');
const mobileThemeIcon = document.getElementById('mobileThemeIcon');

// Minimal Tactical Wind Direction Arrow Marker State (850 hPa Cloud Steering)
let windArrowMarker = null;
let wind850SpeedKmh = 0;
let wind850DirectionDeg = 0;

// Weather HUD Elements (Desktop)
const currentTemp = document.getElementById('currentTemp');
const currentHumidity = document.getElementById('currentHumidity');
const currentRainProb = document.getElementById('currentRainProb');
const currentWind = document.getElementById('currentWind');
const weatherRefreshBadge = document.getElementById('weatherRefreshBadge');

// ETA Elements (Desktop)
const predictedEtaDisplay = document.getElementById('predictedEtaDisplay');
const etaCountdownText = document.getElementById('etaCountdownText');
const etaStateBadge = document.getElementById('etaStateBadge');

// Tactical Storm Status Card Elements
const tacticalStormCard = document.getElementById('tacticalStormCard');
const stormCardIcon = document.getElementById('stormCardIcon');
const stormCardTitle = document.getElementById('stormCardTitle');
const stormCardDesc = document.getElementById('stormCardDesc');
const stormCardBadge = document.getElementById('stormCardBadge');
const headerStormStatusText = document.getElementById('headerStormStatusText');
const headerStormStatusBox = document.getElementById('headerStormStatusBox');

// Playback Elements (Desktop)
const timestampEl = document.getElementById('timestamp');
const frameCounterEl = document.getElementById('frameCounter');
const timelineSlider = document.getElementById('timelineSlider');
const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const playText = document.getElementById('playText');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const firstFrameBtn = document.getElementById('firstFrameBtn');
const lastFrameBtn = document.getElementById('lastFrameBtn');
const speedBtn = document.getElementById('speedBtn');
const speedText = document.getElementById('speedText');
const loopBtn = document.getElementById('loopBtn');
const loopIcon = document.getElementById('loopIcon');
const jumpToLiveBtn = document.getElementById('jumpToLiveBtn');
const timelineModeBadge = document.getElementById('timelineModeBadge');
const opacitySlider = document.getElementById('opacitySlider');
const opacityVal = document.getElementById('opacityVal');

// Mobile UI Elements
const mobileTopBar = document.getElementById('mobileTopBar');
const mobileStationSub = document.getElementById('mobileStationSub');
const mobileZoomBadge = document.getElementById('mobileZoomBadge');
const mobileLocateBtn = document.getElementById('mobileLocateBtn');
const mobileBottomDock = document.getElementById('mobileBottomDock');
const mobilePlayPauseBtn = document.getElementById('mobilePlayPauseBtn');
const mobilePlayIcon = document.getElementById('mobilePlayIcon');
const mobileTimelineSlider = document.getElementById('mobileTimelineSlider');
const mobileTimestampDisplay = document.getElementById('mobileTimestampDisplay');
const mobileLiveBtn = document.getElementById('mobileLiveBtn');
const openDrawerBtn = document.getElementById('openDrawerBtn');
const mobileOpenFeedbackBtn = document.getElementById('mobileOpenFeedbackBtn');

// Mobile Drawer Elements
const mobileDrawerSheet = document.getElementById('mobileDrawerSheet');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const drawerTabBtns = document.querySelectorAll('.drawer-tab-btn');
const drawerTabPanes = document.querySelectorAll('.drawer-tab-pane');

// Mobile Weather & ETA in Drawer
const mobileCurrentTemp = document.getElementById('mobileCurrentTemp');
const mobileCurrentHumidity = document.getElementById('mobileCurrentHumidity');
const mobileCurrentRainProb = document.getElementById('mobileCurrentRainProb');
const mobileCurrentWind = document.getElementById('mobileCurrentWind');
const mobilePredictedEtaDisplay = document.getElementById('mobilePredictedEtaDisplay');
const mobileEtaCountdownText = document.getElementById('mobileEtaCountdownText');
const mobileEtaStateBadge = document.getElementById('mobileEtaStateBadge');
const mobileHourlyForecastContainer = document.getElementById('mobileHourlyForecastContainer');
const mobileOpen7DayModalBtn = document.getElementById('mobileOpen7DayModalBtn');

// Mobile Station & Radar Settings in Drawer
const mobileStationNameDisplay = document.getElementById('mobileStationNameDisplay');
const mobileCoordsDisplay = document.getElementById('mobileCoordsDisplay');
const mobileCustomPinBtn = document.getElementById('mobileCustomPinBtn');
const mobileSetHomeBtn = document.getElementById('mobileSetHomeBtn');
const mobileOpacitySlider = document.getElementById('mobileOpacitySlider');
const mobileOpacityVal = document.getElementById('mobileOpacityVal');
const mobileResetStationBtn = document.getElementById('mobileResetStationBtn');
const mobileSpeedOptions = document.querySelectorAll('.mobile-speed-opt');

// Mobile Drawer Ground-Truth Buttons
const drawerFeedbackEarlyBtn = document.getElementById('drawerFeedbackEarlyBtn');
const drawerFeedbackDelayedBtn = document.getElementById('drawerFeedbackDelayedBtn');
const drawerFeedbackFalseAlarmBtn = document.getElementById('drawerFeedbackFalseAlarmBtn');

// Modal & Ground Truth Elements (Desktop)
const openFeedbackModalBtn = document.getElementById('openFeedbackModalBtn');
const feedbackModalBackdrop = document.getElementById('feedbackModalBackdrop');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalCoords = document.getElementById('modalCoords');
const modalPredictedEta = document.getElementById('modalPredictedEta');
const modalCurrentTime = document.getElementById('modalCurrentTime');
const modalWeatherSummary = document.getElementById('modalWeatherSummary');
const modalStatusFeedback = document.getElementById('modalStatusFeedback');

const feedbackEarlyBtn = document.getElementById('feedbackEarlyBtn');
const feedbackDelayedBtn = document.getElementById('feedbackDelayedBtn');
const feedbackFalseAlarmBtn = document.getElementById('feedbackFalseAlarmBtn');

// Ground-Truth 2-Step Confirmation & Anti-Spam Elements
const gtConfirmBackdrop = document.getElementById('gtConfirmBackdrop');
const gtPromptView = document.getElementById('gtPromptView');
const gtLoadingView = document.getElementById('gtLoadingView');
const gtResultView = document.getElementById('gtResultView');
const gtPreviewBadge = document.getElementById('gtPreviewBadge');
const gtPreviewMeta = document.getElementById('gtPreviewMeta');
const gtCancelBtn = document.getElementById('gtCancelBtn');
const gtConfirmBtn = document.getElementById('gtConfirmBtn');
const gtCountdownNumber = document.getElementById('gtCountdownNumber');
const gtProgressFill = document.getElementById('gtProgressFill');
const gtResultIconBox = document.getElementById('gtResultIconBox');
const gtResultIcon = document.getElementById('gtResultIcon');
const gtResultTitle = document.getElementById('gtResultTitle');
const gtResultSubtext = document.getElementById('gtResultSubtext');
const gtResultActions = document.getElementById('gtResultActions');
const gtResultCloseBtn = document.getElementById('gtResultCloseBtn');

const toastContainer = document.getElementById('toastContainer');

// --- 5. THEME SWITCHER (UI SKIN SWITCH ONLY — ZERO MAP RELOAD) ---
function setTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('skysentry_theme', theme);

  if (theme === 'light') {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
    if (themeIcon) themeIcon.className = 'fa-solid fa-moon';
    if (themeText) themeText.textContent = 'โหมดมืด';
    if (mobileThemeIcon) mobileThemeIcon.className = 'fa-solid fa-moon';
  } else {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
    if (themeIcon) themeIcon.className = 'fa-solid fa-sun';
    if (themeText) themeText.textContent = 'โหมดสว่าง';
    if (mobileThemeIcon) mobileThemeIcon.className = 'fa-solid fa-sun';
  }
}

function toggleTheme() {
  const newTheme = (currentTheme === 'light') ? 'dark' : 'light';
  setTheme(newTheme);
  showToast(
    newTheme === 'light' ? '☀️ สลับเป็นโหมดสว่าง' : '🌙 สลับเป็นโหมดมืด',
    newTheme === 'light' ? 'เปิดใช้งานธีมกระจกฝ้าสว่าง (Light Glassmorphism)' : 'เปิดใช้งานธีมแทคติคอลมืด (Dark Tactical Glassmorphism)'
  );
}

// Initial theme UI synchronization
setTheme(currentTheme);

if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
if (mobileThemeToggleBtn) mobileThemeToggleBtn.addEventListener('click', toggleTheme);

// --- 6. ZOOM BADGE UPDATES ---
function updateZoomBadge() {
  const currentZoom = map.getZoom();
  const text = `ZOOM: ${currentZoom}`;
  if (zoomBadge) zoomBadge.textContent = text;
  if (mobileZoomBadge) mobileZoomBadge.textContent = text;
}
if (map) {
  map.on('zoomend', updateZoomBadge);
  updateZoomBadge();
}

// --- 6. COLLAPSIBLE PANELS LOGIC (DESKTOP) ---
// Left Panel Toggle
if (leftPanelToggleBtn && headerPanel) {
  leftPanelToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    headerPanel.classList.toggle('is-collapsed');
    const isCol = headerPanel.classList.contains('is-collapsed');
    leftPanelToggleBtn.innerHTML = isCol ? '<i class="fa-solid fa-chevron-down"></i>' : '<i class="fa-solid fa-chevron-up"></i>';
    leftPanelToggleBtn.title = isCol ? "ขยายแผงควบคุม" : "พับเก็บแผงควบคุม";
  });

  // Clicking anywhere on collapsed header panel expands it
  headerPanel.addEventListener('click', (e) => {
    if (headerPanel.classList.contains('is-collapsed') && !e.target.closest('.tool-btn') && !e.target.closest('.panel-collapse-btn')) {
      headerPanel.classList.remove('is-collapsed');
      leftPanelToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
    }
  });
}

// Right Panel & Weather Drawer Controls (Windy Style Drawer - Image 1 Match)
function openWeatherDrawer() {
  if (weatherPanel) {
    weatherPanel.classList.remove('is-collapsed');
    document.body.classList.add('weather-dock-open');
    const toggleIcon = document.getElementById('rightPanelToggleIcon');
    if (toggleIcon) toggleIcon.className = 'fa-solid fa-chevron-right';
  }
}

function closeWeatherDrawer() {
  if (weatherPanel) {
    weatherPanel.classList.add('is-collapsed');
    document.body.classList.remove('weather-dock-open');
    const toggleIcon = document.getElementById('rightPanelToggleIcon');
    if (toggleIcon) toggleIcon.className = 'fa-solid fa-chevron-left';
  }
}

function toggleWeatherDrawer() {
  if (!weatherPanel) return;
  if (weatherPanel.classList.contains('is-collapsed')) {
    openWeatherDrawer();
  } else {
    closeWeatherDrawer();
  }
}

if (weatherPillTrigger) {
  weatherPillTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    openWeatherDrawer();
  });
}

if (rightPanelToggleBtn && weatherPanel) {
  rightPanelToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWeatherDrawer();
  });
}

// Top-Left HUD Settings Dropdown / Accordion
if (hudSettingsBtn && hudSettingsMenu) {
  const dropdownWrap = hudSettingsBtn.closest('.hud-dropdown-wrap');
  hudSettingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdownWrap) {
      const isOpen = dropdownWrap.classList.toggle('is-open');
      hudSettingsBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  });

  document.addEventListener('click', (e) => {
    if (dropdownWrap && !dropdownWrap.contains(e.target)) {
      dropdownWrap.classList.remove('is-open');
      hudSettingsBtn.setAttribute('aria-expanded', 'false');
    }
  });

  hudSettingsMenu.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      if (dropdownWrap) {
        dropdownWrap.classList.remove('is-open');
        hudSettingsBtn.setAttribute('aria-expanded', 'false');
      }
    });
  });
}

// Bottom Playback Panel Toggle
if (playbackPanelToggleBtn && playbackPanel) {
  playbackPanelToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playbackPanel.classList.toggle('is-collapsed');
    const isCol = playbackPanel.classList.contains('is-collapsed');
    playbackPanelToggleBtn.innerHTML = isCol ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
    playbackPanelToggleBtn.title = isCol ? "ขยายแถบเวลา" : "ย่อแถบเวลา";
  });

  playbackPanel.addEventListener('click', (e) => {
    if (playbackPanel.classList.contains('is-collapsed') && !e.target.closest('.panel-collapse-btn')) {
      playbackPanel.classList.remove('is-collapsed');
      playbackPanelToggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    }
  });
}

// --- 7. MOBILE DRAWER SYSTEM (< 768px) ---
function openMobileDrawer(targetTab = 'weather') {
  if (mobileDrawerSheet) mobileDrawerSheet.classList.add('is-open');
  if (drawerBackdrop) drawerBackdrop.classList.add('is-open');
  switchDrawerTab(targetTab);
}

function closeMobileDrawer() {
  if (mobileDrawerSheet) mobileDrawerSheet.classList.remove('is-open');
  if (drawerBackdrop) drawerBackdrop.classList.remove('is-open');
}

function switchDrawerTab(tabId) {
  drawerTabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  drawerTabPanes.forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });
}

if (openDrawerBtn) openDrawerBtn.addEventListener('click', () => openMobileDrawer('weather'));
if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeMobileDrawer);
if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeMobileDrawer);

drawerTabBtns.forEach(btn => {
  btn.addEventListener('click', () => switchDrawerTab(btn.dataset.tab));
});

// Sync active class and text on speed buttons across Desktop and Mobile (Feature 1: 🐢 0.5x, 🚶 1x, ⚡ 2x)
function updateSpeedUI() {
  const speed = PLAYBACK_SPEEDS[currentSpeedIndex];
  if (speedText) speedText.textContent = speed.label;
  if (speedBtn) speedBtn.title = `ความเร็วการเล่น: ${speed.label} (คลิกเพื่อสลับ: 0.5x -> 1x -> 2x)`;
  document.documentElement.style.setProperty('--radar-crossfade-duration', speed.crossfadeSec);

  mobileSpeedOptions.forEach(btn => {
    const idx = parseInt(btn.dataset.speed, 10);
    btn.classList.toggle('active', idx === currentSpeedIndex);
  });
}

function setPlaybackSpeed(index) {
  if (index < 0 || index >= PLAYBACK_SPEEDS.length) return;
  currentSpeedIndex = index;
  const speed = PLAYBACK_SPEEDS[currentSpeedIndex];
  updateSpeedUI();
  if (isPlaying) {
    clearInterval(animationTimer);
    animationTimer = setInterval(stepForward, speed.interval);
  }
  showToast('⚡ ปรับความเร็วเรดาร์', `ความเร็ว: ${speed.label} (${speed.interval}ms)`);
}

function cycleSpeed() {
  // 3-Tier Cycling Order: 1 (1x) -> 2 (2x) -> 0 (0.5x) -> 1 (1x)
  let nextIndex;
  if (currentSpeedIndex === 1) nextIndex = 2;
  else if (currentSpeedIndex === 2) nextIndex = 0;
  else nextIndex = 1;
  setPlaybackSpeed(nextIndex);
}

// Mobile speed buttons inside drawer
mobileSpeedOptions.forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.speed, 10);
    setPlaybackSpeed(idx);
  });
});

// --- 8. RAINVIEWER WEATHER RADAR PIPELINE ---
function getTileUrlForFrame(frame) {
  if (!apiData || !apiData.host || !frame) return '';
  // RainViewer Tile Format: {host}{path}/512/{z}/{x}/{y}/{color_scheme}/{smooth}_{snow}.png
  // Scheme 6 = NEXRAD Level III high-contrast palette; 0_1 = crisp unsmoothed edges with snow mask
  return `${apiData.host}${frame.path}/512/{z}/{x}/{y}/6/0_1.png`;
}

function initDualRadarLayers(initialFrame) {
  if (radarLayerA && radarLayerB) return;
  const initialUrl = getTileUrlForFrame(initialFrame);

  radarLayerA = L.tileLayer(initialUrl, {
    tileSize: 512,
    zoomOffset: -1,
    opacity: 0,
    zIndex: 100,
    pane: 'radarPane',
    maxNativeZoom: 7,
    maxZoom: 18,
    crossOrigin: 'anonymous',
    className: 'radar-crossfade-layer'
  }).addTo(map);

  radarLayerB = L.tileLayer(initialUrl, {
    tileSize: 512,
    zoomOffset: -1,
    opacity: 0,
    zIndex: 100,
    pane: 'radarPane',
    maxNativeZoom: 7,
    maxZoom: 18,
    crossOrigin: 'anonymous',
    className: 'radar-crossfade-layer'
  }).addTo(map);

  radarLayerA.on('load', () => {
    scheduleStormTrackerAnalysis(currentFrameIndex);
  });
  radarLayerB.on('load', () => {
    scheduleStormTrackerAnalysis(currentFrameIndex);
  });

  activeLayerRole = 'A';
}

function getActiveRadarLayer() {
  return activeLayerRole === 'A' ? radarLayerA : radarLayerB;
}

function getInactiveRadarLayer() {
  return activeLayerRole === 'A' ? radarLayerB : radarLayerA;
}

function setLayerOpacity(layer, opacity, skipTransition = false) {
  if (!layer) return;
  const container = layer.getContainer();
  if (container && skipTransition) {
    container.classList.add('no-transition');
    layer.setOpacity(opacity);
    void container.offsetHeight; // Force reflow
    container.classList.remove('no-transition');
  } else {
    layer.setOpacity(opacity);
  }
}

/** Preload tiles of the upcoming radar frame to prime the browser cache */
function preloadUpcomingFrame(targetIndex) {
  if (!radarFrames.length || !apiData || !apiData.host) return;
  const nextFrame = radarFrames[targetIndex];
  if (!nextFrame) return;

  const activeLayer = getActiveRadarLayer();
  if (activeLayer && activeLayer._tiles) {
    const nextUrlTemplate = getTileUrlForFrame(nextFrame);
    for (const key in activeLayer._tiles) {
      const tile = activeLayer._tiles[key];
      if (tile && tile.coords) {
        const { x, y, z } = tile.coords;
        const tileUrl = nextUrlTemplate
          .replace('{z}', z)
          .replace('{x}', x)
          .replace('{y}', y);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = tileUrl;
      }
    }
  }
}

function updateSliderTrackNowcastGradient() {
  if (radarFrames.length <= 1 || currentLiveFrameIndex < 0) return;
  const boundaryPct = (currentLiveFrameIndex / (radarFrames.length - 1)) * 100;
  
  document.documentElement.style.setProperty('--nowcast-boundary-pct', `${boundaryPct.toFixed(1)}%`);

  const gradientVal = `linear-gradient(to right, rgba(0, 229, 255, 0.45) 0%, rgba(0, 229, 255, 0.45) ${boundaryPct.toFixed(1)}%, rgba(245, 158, 11, 0.35) ${boundaryPct.toFixed(1)}%, rgba(245, 158, 11, 0.85) 100%)`;
  
  if (timelineSlider) {
    timelineSlider.style.background = gradientVal;
  }
  if (mobileTimelineSlider) {
    mobileTimelineSlider.style.background = gradientVal;
  }
}

async function fetchRadarData() {
  try {
    if (timestampEl) timestampEl.textContent = 'กำลังดึงข้อมูลเรดาร์ RainViewer...';
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!response.ok) {
      throw new Error(`RainViewer HTTP Error: ${response.status}`);
    }

    apiData = await response.json();

    if (apiData && apiData.radar) {
      const past = (apiData.radar && Array.isArray(apiData.radar.past)) ? apiData.radar.past : [];
      let nowcast = (apiData.radar && Array.isArray(apiData.radar.nowcast)) ? apiData.radar.nowcast : [];

      // Fallback: If RainViewer nowcast array is empty, synthesize 3 nowcast intervals (+10, +20, +30 min)
      if (nowcast.length === 0 && past.length > 0) {
        const lastPast = past[past.length - 1];
        nowcast = [
          { time: lastPast.time + 600, path: lastPast.path },
          { time: lastPast.time + 1200, path: lastPast.path },
          { time: lastPast.time + 1800, path: lastPast.path }
        ];
      }

      // Merge both arrays into one master timeline
      radarFrames = [...past, ...nowcast];
      // Identify boundary index between past and future (index of latest past frame = Current Time T0)
      currentLiveFrameIndex = past.length > 0 ? past.length - 1 : 0;
      liveT0Index = currentLiveFrameIndex;

      if (radarFrames.length > 0) {
        // Enable Timeline Controls on Desktop
        if (timelineSlider) {
          timelineSlider.min = 0;
          timelineSlider.max = radarFrames.length - 1;
          timelineSlider.value = currentLiveFrameIndex;
          timelineSlider.disabled = false;
        }
        if (playPauseBtn) playPauseBtn.disabled = false;
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        if (firstFrameBtn) firstFrameBtn.disabled = false;
        if (lastFrameBtn) lastFrameBtn.disabled = false;
        if (jumpToLiveBtn) jumpToLiveBtn.disabled = false;

        // Enable Mobile Slider
        if (mobileTimelineSlider) {
          mobileTimelineSlider.min = 0;
          mobileTimelineSlider.max = radarFrames.length - 1;
          mobileTimelineSlider.value = currentLiveFrameIndex;
          mobileTimelineSlider.disabled = false;
        }

        // Apply past vs nowcast dual track styling
        updateSliderTrackNowcastGradient();

        // Initialize Dual Radar Tile Layers with current live frame (T0)
        initDualRadarLayers(radarFrames[currentLiveFrameIndex]);

        // Render current live radar frame initially (instant, no crossfade)
        showFrame(currentLiveFrameIndex, true);

        // Preload upcoming frame
        preloadUpcomingFrame(Math.min(currentLiveFrameIndex + 1, radarFrames.length - 1));

        // Synchronize Speed UI & CSS timing
        updateSpeedUI();

        initRainPredictionETA();
      } else {
        if (timestampEl) timestampEl.textContent = 'ไม่มีข้อมูลเฟรมเรดาร์ในขณะนี้';
      }
    } else {
      if (timestampEl) timestampEl.textContent = 'ไม่มีข้อมูลเรดาร์ในขณะนี้';
    }
  } catch (err) {
    console.error('Failed to load RainViewer data:', err);
    if (timestampEl) timestampEl.textContent = 'เกิดข้อผิดพลาดในการโหลดเรดาร์ (ตรวจสอบการเชื่อมต่อ)';
    showToast('⚠️ ไม่สามารถเชื่อมต่อ RainViewer API ได้', 'โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  }
}

function showFrame(index, skipCrossfade = false) {
  if (!radarFrames.length) return;

  if (index < 0) index = 0;
  if (index >= radarFrames.length) index = radarFrames.length - 1;

  const targetFrame = radarFrames[index];
  const targetUrl = getTileUrlForFrame(targetFrame);

  const activeLayer = getActiveRadarLayer();
  const inactiveLayer = getInactiveRadarLayer();

  if (skipCrossfade || !activeLayer || currentFrameIndex === -1) {
    // Instant switch without crossfade (slider drag, live jump, first load)
    if (activeLayer) {
      setLayerOpacity(activeLayer, 0, true);
    }
    if (inactiveLayer) {
      inactiveLayer.setUrl(targetUrl);
      setLayerOpacity(inactiveLayer, radarOpacity, true);
      activeLayerRole = (activeLayerRole === 'A' ? 'B' : 'A');
    } else if (activeLayer) {
      activeLayer.setUrl(targetUrl);
      setLayerOpacity(activeLayer, radarOpacity, true);
    }
  } else {
    // Butter-smooth dual-layer GPU crossfade
    inactiveLayer.setUrl(targetUrl);
    setLayerOpacity(inactiveLayer, radarOpacity, false);
    setLayerOpacity(activeLayer, 0, false);
    activeLayerRole = (activeLayerRole === 'A' ? 'B' : 'A');
  }

  currentFrameIndex = index;

  const isNowcast = index > currentLiveFrameIndex;
  const isLiveT0 = index === currentLiveFrameIndex;

  // Sync Sliders & Visual Classes (Past vs Nowcast Future)
  if (timelineSlider) {
    timelineSlider.value = index;
    timelineSlider.classList.toggle('is-nowcast', isNowcast);
    timelineSlider.classList.toggle('is-live-t0', isLiveT0);
  }
  if (mobileTimelineSlider) {
    mobileTimelineSlider.value = index;
    mobileTimelineSlider.classList.toggle('is-nowcast', isNowcast);
    mobileTimelineSlider.classList.toggle('is-live-t0', isLiveT0);
  }
  if (playbackPanel) {
    playbackPanel.classList.toggle('panel-nowcast-active', isNowcast);
  }

  // Format frame timestamp to Bangkok (ICT) time
  const date = new Date(targetFrame.time * 1000);
  const formattedTime = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formattedDate = date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

  // Task 1: 2-Tier Timeline Mode Badge & Clean Timestamp
  if (isNowcast) {
    const liveTime = currentLiveFrameIndex >= 0 && radarFrames[currentLiveFrameIndex] ? radarFrames[currentLiveFrameIndex].time : targetFrame.time;
    const deltaMin = Math.max(1, Math.round((targetFrame.time - liveTime) / 60));
    const fullText = `🕒 พยากรณ์ล่วงหน้า: +${deltaMin} นาที (NOWCAST) • ${formattedDate} ${formattedTime} น. (ICT)`;
    
    if (timestampEl) timestampEl.textContent = fullText;
    if (timelineModeBadge) {
      timelineModeBadge.className = 'timeline-mode-badge badge-nowcast';
      timelineModeBadge.textContent = '🟡 NOWCAST (+30 นาที)';
    }
    if (mobileTimestampDisplay) mobileTimestampDisplay.textContent = `⚡ +${deltaMin}m (Nowcast) ${formattedTime}`;
    if (frameCounterEl) frameCounterEl.textContent = `${index + 1} / ${radarFrames.length} [NOWCAST]`;
  } else if (isLiveT0) {
    const fullText = `🕒 เวลาปัจจุบัน (Live T0) • ${formattedDate} ${formattedTime} น. (ICT)`;

    if (timestampEl) timestampEl.textContent = fullText;
    if (timelineModeBadge) {
      timelineModeBadge.className = 'timeline-mode-badge badge-live';
      timelineModeBadge.textContent = '🟢 LIVE (ปัจจุบัน)';
    }
    if (mobileTimestampDisplay) mobileTimestampDisplay.textContent = `🟢 สด ${formattedTime} [${index + 1}/${radarFrames.length}]`;
    if (frameCounterEl) frameCounterEl.textContent = `${index + 1} / ${radarFrames.length} [LIVE]`;
  } else {
    const liveTime = currentLiveFrameIndex >= 0 && radarFrames[currentLiveFrameIndex] ? radarFrames[currentLiveFrameIndex].time : targetFrame.time;
    const pastDeltaMin = Math.max(1, Math.round((liveTime - targetFrame.time) / 60));
    const fullText = `🕒 เรดาร์ย้อนหลัง: -${pastDeltaMin} นาที • ${formattedDate} ${formattedTime} น. (ICT)`;

    if (timestampEl) timestampEl.textContent = fullText;
    if (timelineModeBadge) {
      timelineModeBadge.className = 'timeline-mode-badge badge-past';
      timelineModeBadge.textContent = '● PAST (-2 ชม.)';
    }
    if (mobileTimestampDisplay) mobileTimestampDisplay.textContent = `⏪ -${pastDeltaMin}m ${formattedTime}`;
    if (frameCounterEl) frameCounterEl.textContent = `${index + 1} / ${radarFrames.length}`;
  }

  // Preload upcoming frame during active playback
  if (isPlaying) {
    const nextIdx = (index + 1) % radarFrames.length;
    preloadUpcomingFrame(nextIdx);
  }

  // Trigger Phase 2 Tactical Storm Tracker analysis
  scheduleStormTrackerAnalysis(index);
}

function stepForward() {
  let nextIndex = currentFrameIndex + 1;
  if (nextIndex >= radarFrames.length) {
    if (isLooping) {
      nextIndex = 0;
    } else {
      if (isPlaying) togglePlay();
      return;
    }
  }
  showFrame(nextIndex, false);
}

function stepBackward() {
  let prevIndex = currentFrameIndex - 1;
  if (prevIndex < 0) {
    prevIndex = radarFrames.length - 1;
  }
  showFrame(prevIndex, false);
}

function togglePlay() {
  if (isPlaying) {
    clearInterval(animationTimer);
    animationTimer = null;
    isPlaying = false;
    if (playIcon) playIcon.className = 'fa-solid fa-play';
    if (playText) playText.textContent = 'เล่นเรดาร์';
    if (mobilePlayIcon) mobilePlayIcon.className = 'fa-solid fa-play';
  } else {
    isPlaying = true;
    if (playIcon) playIcon.className = 'fa-solid fa-pause';
    if (playText) playText.textContent = 'หยุดชั่วคราว';
    if (mobilePlayIcon) mobilePlayIcon.className = 'fa-solid fa-pause';
    const interval = PLAYBACK_SPEEDS[currentSpeedIndex].interval;
    animationTimer = setInterval(stepForward, interval);
  }
}

// --- 9. LIVE WEATHER & 7-DAY FORECAST (OPEN-METEO) ---
const WMO_CODE_MAP = {
  0: { desc: "ท้องฟ้าแจ่มใส", icon: "fa-sun", color: "#facc15" },
  1: { desc: "โปร่งเป็นส่วนใหญ่", icon: "fa-cloud-sun", color: "#fde047" },
  2: { desc: "มีเมฆเป็นบางส่วน", icon: "fa-cloud-sun", color: "#cbd5e1" },
  3: { desc: "มีเมฆมาก", icon: "fa-cloud", color: "#94a3b8" },
  45: { desc: "มีหมอกลง", icon: "fa-smog", color: "#94a3b8" },
  48: { desc: "หมอกน้ำค้างจัด", icon: "fa-smog", color: "#94a3b8" },
  51: { desc: "ฝนละอองเบาบาง", icon: "fa-cloud-rain", color: "#38bdf8" },
  53: { desc: "ฝนละอองปานกลาง", icon: "fa-cloud-rain", color: "#0284c7" },
  55: { desc: "ฝนละอองหนาแน่น", icon: "fa-cloud-showers-heavy", color: "#0369a1" },
  61: { desc: "ฝนตกเล็กน้อย", icon: "fa-cloud-rain", color: "#38bdf8" },
  63: { desc: "ฝนตกปานกลาง", icon: "fa-cloud-showers-heavy", color: "#00e5ff" },
  65: { desc: "ฝนตกหนัก", icon: "fa-cloud-showers-heavy", color: "#0284c7" },
  80: { desc: "ฝนซู่กระจายเล็กน้อย", icon: "fa-cloud-showers-water", color: "#38bdf8" },
  81: { desc: "ฝนซู่ปานกลาง", icon: "fa-cloud-showers-heavy", color: "#00e5ff" },
  82: { desc: "ฝนซู่รุนแรงมาก", icon: "fa-cloud-showers-heavy", color: "#f43f5e" },
  95: { desc: "พายุฝนฟ้าคะนอง", icon: "fa-cloud-bolt", color: "#e11d48" },
  96: { desc: "พายุฝนฟ้าคะนองรุนแรง", icon: "fa-bolt-lightning", color: "#be123c" }
};

async function fetchOpenMeteoWeather(lat, lon) {
  try {
    if (weatherRefreshBadge) weatherRefreshBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> อัปเดต';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_850hPa,wind_direction_850hPa,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FBangkok&forecast_days=7`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    if (data.current) {
      const temp = Math.round(data.current.temperature_2m * 10) / 10;
      const humidity = data.current.relative_humidity_2m ?? "--";
      const rainProb = data.current.precipitation_probability ?? "--";
      const wind = Math.round(data.current.wind_speed_10m * 10) / 10;
      const windDir = data.current.wind_direction_10m ?? 0;

      // Update Desktop
      if (currentTemp) currentTemp.textContent = `${temp} °C`;
      if (currentHumidity) currentHumidity.textContent = `${humidity} %`;
      if (currentRainProb) currentRainProb.textContent = `${rainProb} %`;
      if (currentWind) currentWind.textContent = `${wind} km/h`;

      // Update Mobile Drawer
      if (mobileCurrentTemp) mobileCurrentTemp.textContent = `${temp} °C`;
      if (mobileCurrentHumidity) mobileCurrentHumidity.textContent = `${humidity} %`;
      if (mobileCurrentRainProb) mobileCurrentRainProb.textContent = `${rainProb} %`;
      if (mobileCurrentWind) mobileCurrentWind.textContent = `${wind} km/h`;

      // Update Collapsed Header Chip & Floating Weather Pill
      if (collapsedWeatherChip) collapsedWeatherChip.textContent = `${temp}°C 🌧️ ${rainProb}%`;
      if (pillTemp) pillTemp.textContent = `${temp}°C`;
      if (pillHumidity) pillHumidity.textContent = `${humidity}%`;

      activeWeatherSummary = `${temp}°C, ความชื้น ${humidity}%, ลม ${wind} km/h, ฝน ${rainProb}%`;

      // Extract 850 hPa wind speed & direction (cloud steering level) for minimal wind arrow marker
      let speed850 = wind;
      let dir850 = windDir;
      if (data.hourly) {
        if (Array.isArray(data.hourly.wind_speed_850hPa) && data.hourly.wind_speed_850hPa[0] != null) {
          speed850 = Math.round(Number(data.hourly.wind_speed_850hPa[0]) * 10) / 10;
        }
        if (Array.isArray(data.hourly.wind_direction_850hPa) && data.hourly.wind_direction_850hPa[0] != null) {
          dir850 = Math.round(Number(data.hourly.wind_direction_850hPa[0]));
        }
      }
      latestWind850 = { speed: speed850, dir: dir850 };
      updateWindArrowMarker(speed850, dir850);
    }

    // Extract hourly precipitation for Rain Inspector use
    if (data.hourly && Array.isArray(data.hourly.precipitation)) {
      window._skysentryCurrentPrecip = data.hourly.precipitation[0] ?? 0;
      renderHourlyForecast(data.hourly);
    }

    // Render 7-day outlook inside the dedicated modal
    if (data.daily && Array.isArray(data.daily.time)) {
      renderDailyForecast(data.daily, modal7DayCardsContainer);
    }

    if (weatherRefreshBadge) weatherRefreshBadge.innerHTML = '<i class="fa-solid fa-check"></i> สด';
  } catch (err) {
    console.error('Failed to load Open-Meteo weather:', err);
    if (weatherRefreshBadge) weatherRefreshBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ออฟไลน์';
    activeWeatherSummary = "28.5°C, ความชื้น 80%, ลม 12.0 km/h, โอกาสฝน 40%";
  }
}

/** Render Next 12 Hours Forecast Strip (Windy.com Style) */
function renderHourlyForecast(hourly) {
  if (!hourly || !Array.isArray(hourly.time)) return;

  const now = new Date();
  const currentHourTime = now.getTime();

  // Find index closest to now
  let startIdx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]).getTime();
    if (t >= currentHourTime - 30 * 60 * 1000) {
      startIdx = i;
      break;
    }
  }

  const containers = [hourlyForecastContainer, mobileHourlyForecastContainer];
  containers.forEach(container => {
    if (!container) return;
    container.innerHTML = '';

    const limit = Math.min(startIdx + 12, hourly.time.length);
    for (let i = startIdx; i < limit; i++) {
      const timeDate = new Date(hourly.time[i]);
      const hourStr = timeDate.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const hour = timeDate.getHours();

      // Astronomical day/night check via Open-Meteo is_day, with local hour fallback
      const isDay = (hourly.is_day && hourly.is_day[i] != null)
        ? (Number(hourly.is_day[i]) === 1)
        : (hour >= 6 && hour < 18);

      const temp = Math.round(hourly.temperature_2m[i]);
      const rainProb = hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0;
      const precipMm = hourly.precipitation ? Math.round(hourly.precipitation[i] * 10) / 10 : 0;
      const code = hourly.weather_code ? hourly.weather_code[i] : 0;
      const wmo = WMO_CODE_MAP[code] || { desc: "มีเมฆ", icon: "fa-cloud", color: "#94a3b8" };

      // Nighttime moon icon adaptation (Moon / Cloud-Moon instead of Sun)
      let iconClass = wmo.icon;
      let descText = wmo.desc;
      let isNightMoon = false;

      if (!isDay) {
        if (code === 0) {
          iconClass = "fa-moon";
          descText = "ท้องฟ้าแจ่มใส (กลางคืน)";
          isNightMoon = true;
        } else if (code === 1) {
          iconClass = "fa-cloud-moon";
          descText = "โปร่งเป็นส่วนใหญ่ (กลางคืน)";
          isNightMoon = true;
        } else if (code === 2) {
          iconClass = "fa-cloud-moon";
          descText = "มีเมฆเป็นบางส่วน (กลางคืน)";
          isNightMoon = true;
        }
      }

      const card = document.createElement('div');
      card.className = `hourly-forecast-card ${isNightMoon ? 'is-night-card' : ''}`;
      card.title = `${hourStr} น.: ${descText}, อุณหภูมิ ${temp}°C, โอกาสฝน ${rainProb}% (${precipMm} mm)`;

      // If nighttime moon, omit inline color so CSS controls pure white in dark mode and golden amber in light mode
      const iconStyle = isNightMoon ? '' : `style="color:${wmo.color};"`;
      const iconExtraClass = isNightMoon ? 'night-icon' : '';

      card.innerHTML = `
        <span class="hourly-time">${hourStr}</span>
        <div class="hourly-icon ${iconExtraClass}" ${iconStyle}>
          <i class="fa-solid ${iconClass}"></i>
        </div>
        <span class="hourly-temp">${temp}°</span>
        <span class="hourly-rain"><i class="fa-solid fa-droplet"></i> ${rainProb}%</span>
      `;
      container.appendChild(card);
    }
  });
}

/** Render 7-Day Outlook Cards in Dedicated Modal */
function renderDailyForecast(daily, container) {
  if (!container || !daily || !Array.isArray(daily.time)) return;
  container.innerHTML = '';
  const dayNamesThai = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

  for (let i = 0; i < Math.min(daily.time.length, 7); i++) {
    const dateObj = new Date(daily.time[i]);
    const dayLabel = i === 0 ? "วันนี้" : dayNamesThai[dateObj.getDay()];
    const dateFormatted = `${dateObj.getDate()} ${dateObj.toLocaleDateString('th-TH', { month: 'short' })}`;

    const code = daily.weather_code ? daily.weather_code[i] : 0;
    const wmo = WMO_CODE_MAP[code] || { desc: "มีเมฆ", icon: "fa-cloud", color: "#94a3b8" };

    const maxTemp = Math.round(daily.temperature_2m_max[i]);
    const minTemp = Math.round(daily.temperature_2m_min[i]);
    const rainProb = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0;

    const card = document.createElement('div');
    card.className = 'forecast-mini-card';
    card.title = `${wmo.desc} (ฝนสูงสุด ${rainProb}%)`;
    card.innerHTML = `
      <span class="forecast-day">${dayLabel}</span>
      <span class="forecast-date">${dateFormatted}</span>
      <div class="forecast-icon" style="color:${wmo.color};">
        <i class="fa-solid ${wmo.icon}"></i>
      </div>
      <span class="forecast-temps">${maxTemp}° / ${minTemp}°</span>
      <span class="forecast-rain-prob"><i class="fa-solid fa-droplet"></i> ${rainProb}%</span>
    `;
    container.appendChild(card);
  }
}

// 7-Day Outlook Modal Open/Close Controls (Feature 4)
function open7DayModal() {
  if (sevenDayModalBackdrop) {
    sevenDayModalBackdrop.classList.add('is-open', 'active');
    sevenDayModalBackdrop.setAttribute('aria-hidden', 'false');
  }
}

function close7DayModal() {
  if (sevenDayModalBackdrop) {
    sevenDayModalBackdrop.classList.remove('is-open', 'active');
    sevenDayModalBackdrop.setAttribute('aria-hidden', 'true');
  }
}

// --- CUSTOM PIN & SET AS HOME LOCATION SYSTEM (Feature 5) ---
let isCustomPinMode = false;

function toggleCustomPinMode() {
  isCustomPinMode = !isCustomPinMode;
  if (customPinBtn) customPinBtn.classList.toggle('active', isCustomPinMode);
  if (mobileCustomPinBtn) mobileCustomPinBtn.classList.toggle('active', isCustomPinMode);
  map.getContainer().style.cursor = isCustomPinMode ? 'crosshair' : '';

  if (isCustomPinMode) {
    showToast('📍 โหมดเลือกพิกัดเปิดใช้งาน', 'กรุณาคลิกบนแผนที่เพื่อปักหมุดตำแหน่งที่ต้องการ');
  } else {
    showToast('📍 ปิดโหมดเลือกพิกัด', 'กลับสู่โหมดสำรวจปกติ');
  }
}

function setTargetLocation(coords, name) {
  currentCoords = [coords[0], coords[1]];
  currentStationName = name;

  const latVal = currentCoords[0].toFixed(4);
  const lonVal = currentCoords[1].toFixed(4);
  const latStr = `${latVal}° N, ${lonVal}° E`;
  if (stationNameDisplay) stationNameDisplay.textContent = currentStationName;
  if (coordsDisplay) coordsDisplay.textContent = latStr;
  if (coordsDisplayLat) coordsDisplayLat.textContent = `${latVal}° N,`;
  if (coordsDisplayLon) coordsDisplayLon.textContent = `${lonVal}° E`;
  if (modalCoords) modalCoords.textContent = `${currentCoords[0].toFixed(4)}, ${currentCoords[1].toFixed(4)} (${currentStationName})`;
  if (mobileStationSub) mobileStationSub.textContent = currentStationName;
  if (mobileStationNameDisplay) mobileStationNameDisplay.textContent = currentStationName;
  if (mobileCoordsDisplay) mobileCoordsDisplay.textContent = latStr;

  stormCentroidCache = {};
  clearStormVisualLayers();

  updateRadarRangeRings(currentCoords);
  if (windArrowMarker) windArrowMarker.setLatLng(currentCoords);
  fetchOpenMeteoWeather(currentCoords[0], currentCoords[1]);
  map.panTo(currentCoords);
  scheduleStormTrackerAnalysis(currentFrameIndex);
}

function saveCurrentLocationAsHome() {
  try {
    const homeObj = { lat: currentCoords[0], lon: currentCoords[1] };
    localStorage.setItem('skysentry_home', JSON.stringify(homeObj));
    localStorage.setItem('skysentry_home_coords', JSON.stringify(currentCoords));
    localStorage.setItem('skysentry_home_name', currentStationName);
    showToast('🏠 บันทึกตำแหน่งบ้านสำเร็จ', `พิกัด [${currentCoords[0].toFixed(4)}, ${currentCoords[1].toFixed(4)}] บันทึกลงระบบแล้ว`);
  } catch (err) {
    console.error('Failed to save home location:', err);
    showToast('⚠️ ไม่สามารถบันทึกได้', 'เกิดข้อผิดพลาดในการเข้าถึง localStorage');
  }
}

function resetLocation() {
  const savedHome = localStorage.getItem('skysentry_home') || localStorage.getItem('skysentry_home_coords');
  if (savedHome) {
    try {
      const parsed = JSON.parse(savedHome);
      let coords = null;
      if (parsed && typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
        coords = [parsed.lat, parsed.lon];
      } else if (Array.isArray(parsed) && parsed.length === 2) {
        coords = [parsed[0], parsed[1]];
      }
      if (coords) {
        const name = localStorage.getItem('skysentry_home_name') || `ตำแหน่งบ้าน [${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]`;
        setTargetLocation(coords, name);
        showToast('🏠 กลับสู่ตำแหน่งบ้าน', name);
        return;
      }
    } catch (e) {
      console.warn('Error resetting to saved home:', e);
    }
  }
  setTargetLocation(DEFAULT_COORDS, DEFAULT_STATION_NAME);
  showToast('🎯 รีเซ็ตสู่ค่าเริ่มต้น', DEFAULT_STATION_NAME);
}

// --- 10. TACTICAL STORM TRACKER & GEODESIC ETA ENGINE (PHASE 2) ---

/**
 * Geodesic Distance via Haversine Formula (kilometers)
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0; // Earth mean radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geodesic Forward Azimuth / Bearing (degrees 0 - 360)
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return (theta * 180 / Math.PI + 360) % 360;
}

/**
 * Great Circle Destination Point: projects start point along bearing for distance (km)
 */
function destinationPoint(lat1, lon1, bearingDeg, distanceKm) {
  const R = 6371.0;
  const delta = distanceKm / R; // Angular distance in radians
  const theta = bearingDeg * Math.PI / 180;
  const phi1 = lat1 * Math.PI / 180;
  const lambda1 = lon1 * Math.PI / 180;

  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) +
                  Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);

  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  const lat2 = phi2 * 180 / Math.PI;
  const lon2 = ((lambda2 * 180 / Math.PI + 540) % 360) - 180;
  return [lat2, lon2];
}

/**
 * Converts degrees into 8-point Thai Compass Direction
 */
function bearingToCompassThai(deg) {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return 'ทิศเหนือ (N)';
  if (norm >= 22.5 && norm < 67.5) return 'ทิศตะวันออกเฉียงเหนือ (NE)';
  if (norm >= 67.5 && norm < 112.5) return 'ทิศตะวันออก (E)';
  if (norm >= 112.5 && norm < 157.5) return 'ทิศตะวันออกเฉียงใต้ (SE)';
  if (norm >= 157.5 && norm < 202.5) return 'ทิศใต้ (S)';
  if (norm >= 202.5 && norm < 247.5) return 'ทิศตะวันตกเฉียงใต้ (SW)';
  if (norm >= 247.5 && norm < 292.5) return 'ทิศตะวันตก (W)';
  return 'ทิศตะวันตกเฉียงเหนือ (NW)';
}

function formatDateTimeString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Offscreen Canvas Sampling to extract storm cells (>= 20 dBZ Watch Level, >= 35 dBZ Warning Level).
 * Avoids browser freezes via step=10 grid sampling.
 * Converts screen coords to Geodesic Lat/Lon via map.containerPointToLatLng.
 */
function extractStormCellsFromTileLayer(layer) {
  if (!layer || !layer._tiles || !map) return [];

  const mapContainer = map.getContainer();
  const width = mapContainer.clientWidth;
  const height = mapContainer.clientHeight;
  if (!width || !height) return [];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const mapRect = mapContainer.getBoundingClientRect();
  let drawnCount = 0;

  for (const key in layer._tiles) {
    const tile = layer._tiles[key];
    if (!tile.el || !tile.el.complete || !tile.el.naturalWidth) continue;

    const tileRect = tile.el.getBoundingClientRect();
    const dx = tileRect.left - mapRect.left;
    const dy = tileRect.top - mapRect.top;
    try {
      ctx.drawImage(tile.el, dx, dy, tileRect.width, tileRect.height);
      drawnCount++;
    } catch (e) {
      // Cross-origin fallback protection
    }
  }

  if (drawnCount === 0) return [];

  let imgData;
  try {
    imgData = ctx.getImageData(0, 0, width, height).data;
  } catch (err) {
    console.warn('Canvas getImageData fallback:', err);
    return [];
  }

  const stormPoints = [];
  const step = 10; // Grid Sampling step to prevent browser lag (per prompt instruction)

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const a = imgData[idx + 3];
      if (a < 35) continue; // Transparent / Clear sky

      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];

      const dbz = sampleDbzFromPixel(r, g, b, a);
      if (dbz >= 20.0) {
        // Unproject screen (x, y) to geographic [Lat, Lon]
        const latlng = map.containerPointToLatLng(L.point(x, y));
        stormPoints.push({
          lat: latlng.lat,
          lng: latlng.lng,
          dbz: dbz
        });
      }
    }
  }

  return stormPoints;
}

/**
 * Clears tactical storm visual markers and vectors from Leaflet map safely.
 */
function clearStormVisualLayers() {
  if (stormTrajectoryLine && map && map.hasLayer(stormTrajectoryLine)) {
    map.removeLayer(stormTrajectoryLine);
  }
  if (stormInterceptCone && map && map.hasLayer(stormInterceptCone)) {
    map.removeLayer(stormInterceptCone);
  }
  if (stormCentroidMarker && map && map.hasLayer(stormCentroidMarker)) {
    map.removeLayer(stormCentroidMarker);
  }
  if (stormInterceptMarker && map && map.hasLayer(stormInterceptMarker)) {
    map.removeLayer(stormInterceptMarker);
  }
}

/**
 * Updates Tactical Storm Status Card and Header Status Text.
 * Synchronizes alert state: normal, watch, warning, raining.
 * Triggers Synthesized Tactical Beep (Web Audio API) when Red Warning is activated.
 */
function updateTacticalStormCard({ alertState, title, desc, badge, headerText }) {
  if (tacticalStormCard) {
    tacticalStormCard.className = `tactical-panel tactical-storm-card alert-${alertState}`;
  }
  if (stormCardIcon) {
    let iconHtml = '<i class="fa-solid fa-circle-check"></i>';
    if (alertState === 'watch') iconHtml = '<i class="fa-solid fa-cloud-sun-rain"></i>';
    else if (alertState === 'warning') iconHtml = '<i class="fa-solid fa-triangle-exclamation"></i>';
    else if (alertState === 'raining') iconHtml = '<i class="fa-solid fa-cloud-showers-heavy"></i>';
    stormCardIcon.innerHTML = iconHtml;
  }
  if (stormCardTitle) stormCardTitle.textContent = title;
  if (stormCardDesc) stormCardDesc.textContent = desc;
  if (stormCardBadge) stormCardBadge.textContent = badge;
  if (headerStormStatusText) headerStormStatusText.textContent = headerText || title;

  // Feature 7: Synthesized Tactical Alert Chime on Red Warning transition
  if (alertState === 'warning' && previousAlertState !== 'warning') {
    playTacticalWarningChime();
  }
  previousAlertState = alertState;
}

/**
 * Isolates the single significant rain cell closest to target location.
 * Avoids multi-storm merging by clustering within 15 km of the nearest rain point.
 */
function findNearestStormCentroid(stormPoints, homeCoords) {
  if (!stormPoints || stormPoints.length === 0) return null;

  const [homeLat, homeLng] = homeCoords;
  const SEARCH_RADIUS_KM = 40; // 40 km perimeter around station

  // 1. Filter points within search radius and find closest threat point
  const candidatePoints = [];
  let closestPoint = null;
  let minDistanceToHome = Infinity;

  for (const pt of stormPoints) {
    const distToHome = haversineDistanceKm(homeLat, homeLng, pt.lat, pt.lng);
    if (distToHome <= SEARCH_RADIUS_KM) {
      const item = { ...pt, distToHome };
      candidatePoints.push(item);
      if (distToHome < minDistanceToHome) {
        minDistanceToHome = distToHome;
        closestPoint = item;
      }
    }
  }

  if (!closestPoint || candidatePoints.length === 0) {
    return null;
  }

  // 2. Isolate single cell cluster within 15 km of the closest point (prevents merging far-off storms)
  const CELL_RADIUS_KM = 15;
  const cellCluster = candidatePoints.filter(pt =>
    haversineDistanceKm(closestPoint.lat, closestPoint.lng, pt.lat, pt.lng) <= CELL_RADIUS_KM
  );

  if (cellCluster.length === 0) return null;

  // 3. Compute geographic Centroid (Average Lat, Average Lon)
  let sumLat = 0;
  let sumLng = 0;
  let maxDbz = 0;

  for (const pt of cellCluster) {
    sumLat += pt.lat;
    sumLng += pt.lng;
    if (pt.dbz > maxDbz) maxDbz = pt.dbz;
  }

  const centroidLat = sumLat / cellCluster.length;
  const centroidLng = sumLng / cellCluster.length;
  const distToHome = haversineDistanceKm(homeLat, homeLng, centroidLat, centroidLng);

  return {
    lat: centroidLat,
    lng: centroidLng,
    distToHome: Math.round(distToHome * 10) / 10,
    maxDbz: Math.round(maxDbz * 10) / 10,
    pointCount: cellCluster.length
  };
}

/**
 * Debounced trigger for Tactical Storm Tracker analysis
 */
function scheduleStormTrackerAnalysis(index) {
  if (stormTrackerDebounceTimer) {
    clearTimeout(stormTrackerDebounceTimer);
  }
  stormTrackerDebounceTimer = setTimeout(() => {
    runStormTrackerAnalysis(index);
  }, 120);
}

/**
 * Main Storm Tracker Analysis Engine:
 * Analyzes active frame and preceding frame, computes speed & bearing,
 * projects +15, +30, +60 min trajectory, renders intercept pin, calculates ETA to 5 km perimeter.
 */
function runStormTrackerAnalysis(targetIndex) {
  if (!radarFrames.length || targetIndex < 0 || targetIndex >= radarFrames.length || !map) return;

  const currentFrame = radarFrames[targetIndex];
  const currentLayer = getActiveRadarLayer();
  if (!currentLayer) return;

  const [homeLat, homeLng] = currentCoords;

  // 1. Dual-Threshold Filter: Watch Level >= 20 dBZ, Warning Level >= 35 dBZ
  const WATCH_THRESHOLD_DBZ = 20.0;
  const WARNING_THRESHOLD_DBZ = 35.0;

  // Extract storm cells from active layer (>= 20 dBZ)
  const stormPoints = extractStormCellsFromTileLayer(currentLayer);

  // 2. Direct-Hit Bypass:
  // If ANY rain >= 20 dBZ is detected within 1.5 km of the target pin,
  // immediately flag status as "🌧️ ฝนกำลังตกในพื้นที่เป้าหมาย" and bypass the ETA division formula
  const isDirectHit = stormPoints.some(pt => {
    return pt.dbz >= WATCH_THRESHOLD_DBZ && haversineDistanceKm(homeLat, homeLng, pt.lat, pt.lng) <= 1.5;
  });

  if (isDirectHit) {
    clearStormVisualLayers();
    currentPredictedEta = null;
    const directHitDbz = Math.max(...stormPoints.filter(p => haversineDistanceKm(homeLat, homeLng, p.lat, p.lng) <= 1.5).map(p => p.dbz), 25);
    latestStormTrackingData = {
      speedKmh: 0,
      bearingDeg: 0,
      compassStr: 'ในพื้นที่',
      distToHome: 0,
      maxDbz: directHitDbz,
      isApproaching: false,
      isRainingNow: true
    };

    updateTacticalStormCard({
      alertState: 'raining',
      title: '🌧️ ปะทะตรง: มีกลุ่มฝนตกในพื้นที่เป้าหมายขณะนี้',
      desc: `ตรวจพบกลุ่มฝน (≥ 20 dBZ) ตกปกคลุมในรัศมี 1.5 กม. จาก${currentStationName} กรุณาเตรียมรับมือหรือหลบในอาคาร`,
      badge: 'DIRECT HIT // RAINING',
      headerText: '🌧️ ฝนกำลังตกในพื้นที่เป้าหมาย'
    });

    updateEtaUI({
      badgeText: 'DIRECT HIT / RAINING NOW',
      badgeClass: 'badge-critical',
      etaTimeStr: 'ฝนกำลังตกขณะนี้ (Direct-Hit)',
      countdownHtml: `<span style="color: #38bdf8; font-weight: 700;">🌧️ ตรวจพบเมฆฝนตกปกคลุมพื้นที่เป้าหมายแล้ว (ระยะ < 1.5 กม.)</span><br>ระบบระงับการคำนวณสูตร ETA เพื่อป้องกันความคลาดเคลื่อนเนื่องจากอยู่ในรัศมีฝนตกโดยตรง (Bypass Division)`
    });
    return;
  }

  // 3. Nearest Threat Clustering:
  // Identify the storm cluster closest to the target pin within a 40 km radius
  let currentCentroid = stormCentroidCache[currentFrame.path];
  if (!currentCentroid) {
    currentCentroid = findNearestStormCentroid(stormPoints, currentCoords);
    if (currentCentroid) {
      currentCentroid.time = currentFrame.time;
      stormCentroidCache[currentFrame.path] = currentCentroid;
    }
  }

  // 4. Normal Sky State: No storm cluster within 40 km
  if (!currentCentroid) {
    clearStormVisualLayers();
    currentPredictedEta = null;
    latestStormTrackingData = null;

    updateTacticalStormCard({
      alertState: 'normal',
      title: 'สภาพอากาศปกติ • ไม่พบกลุ่มฝนคุกคามในรัศมี 40 กม.',
      desc: 'เรดาร์ตรวจการณ์ 40 กม.: ไม่พบกลุ่มเมฆเคลื่อนตัวเข้าหาเป้าหมาย',
      badge: 'NORMAL // 40KM',
      headerText: 'สภาพอากาศปกติ (40 กม.)'
    });

    updateEtaUI({
      badgeText: 'CLEAR / STANDBY',
      badgeClass: 'badge-clear',
      etaTimeStr: 'ไม่มีสัญญาณฝนตกหนัก',
      countdownHtml: '<div class="hud-subtle-indicator"><i class="fa-solid fa-satellite-dish"></i> เรดาร์ตรวจการณ์ 40 กม.: ไม่พบกลุ่มเมฆเคลื่อนตัวเข้าหาเป้าหมาย</div>'
    });
    return;
  }

  // 5. Look back in time to find previous frame centroid (Frame T-1) for geodesic vector tracking
  let prevCentroid = null;
  for (let offset = 1; offset <= 3; offset++) {
    const prevIdx = targetIndex - offset;
    if (prevIdx < 0) break;
    const pFrame = radarFrames[prevIdx];
    if (stormCentroidCache[pFrame.path]) {
      prevCentroid = stormCentroidCache[pFrame.path];
      break;
    } else {
      const pLayer = getInactiveRadarLayer();
      if (pLayer && pLayer._tiles) {
        const pPoints = extractStormCellsFromTileLayer(pLayer);
        const pCentroid = findNearestStormCentroid(pPoints, currentCoords);
        if (pCentroid) {
          pCentroid.time = pFrame.time;
          stormCentroidCache[pFrame.path] = pCentroid;
          prevCentroid = pCentroid;
          break;
        }
      }
    }
  }

  // 6. Geodesic Vectoring: Speed (km/h) via Haversine formula over frame time delta
  let speedKmh = 0;
  let bearingDeg = 0;

  if (prevCentroid && currentCentroid.time > prevCentroid.time) {
    const distKm = haversineDistanceKm(prevCentroid.lat, prevCentroid.lng, currentCentroid.lat, currentCentroid.lng);
    const deltaMins = Math.max(5, (currentCentroid.time - prevCentroid.time) / 60);
    speedKmh = Math.round((distKm / deltaMins) * 60 * 10) / 10;
    bearingDeg = calculateBearing(prevCentroid.lat, prevCentroid.lng, currentCentroid.lat, currentCentroid.lng);

    if (distKm < 0.35 || speedKmh < 3) {
      speedKmh = 0; // Stationary
      bearingDeg = latestWind850.dir || 220;
    }
  } else {
    // Fallback: estimate from physical 850 hPa cloud steering wind
    speedKmh = latestWind850.speed || 15;
    bearingDeg = latestWind850.dir || 220;
  }

  const compassStr = bearingToCompassThai(bearingDeg);

  // 7. Dynamic projected dashed trajectory line (L.polyline) up to 60 minutes ahead (+15, +30, +45, +60 min)
  const speedForProj = speedKmh > 0 ? speedKmh : 15;
  const d15 = (speedForProj / 60) * 15;
  const d30 = (speedForProj / 60) * 30;
  const d45 = (speedForProj / 60) * 45;
  const d60 = (speedForProj / 60) * 60;
  const pt15 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg, d15);
  const pt30 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg, d30);
  const pt45 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg, d45);
  const pt60 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg, d60);

  const polylineCoords = [
    [currentCentroid.lat, currentCentroid.lng],
    pt15,
    pt30,
    pt45,
    pt60
  ];

  if (!stormTrajectoryLine) {
    stormTrajectoryLine = L.polyline(polylineCoords, {
      color: '#ef4444',
      weight: 3.5,
      dashArray: '6, 6',
      opacity: 0.9,
      pane: 'overlayPane'
    }).addTo(map);
  } else {
    stormTrajectoryLine.setLatLngs(polylineCoords);
    if (!map.hasLayer(stormTrajectoryLine)) stormTrajectoryLine.addTo(map);
  }

  // Predicted Intercept Cone (Dispersion fan envelope up to 60 min ahead)
  const coneLeft30 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg - 14, d30);
  const coneLeft60 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg - 20, d60);
  const coneTip60 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg, d60 * 1.05);
  const coneRight60 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg + 20, d60);
  const coneRight30 = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg + 14, d30);

  const coneCoords = [
    [currentCentroid.lat, currentCentroid.lng],
    coneLeft30,
    coneLeft60,
    coneTip60,
    coneRight60,
    coneRight30
  ];

  if (!stormInterceptCone) {
    stormInterceptCone = L.polygon(coneCoords, {
      color: '#f59e0b',
      weight: 1.5,
      dashArray: '4, 4',
      fillColor: '#f59e0b',
      fillOpacity: 0.12,
      pane: 'overlayPane',
      interactive: false
    }).addTo(map);
  } else {
    stormInterceptCone.setLatLngs(coneCoords);
    if (!map.hasLayer(stormInterceptCone)) stormInterceptCone.addTo(map);
  }

  // 8. Centroid Marker with Pulsing Radar Ring & dBZ Badge
  const centroidHtml = `
    <div class="storm-centroid-pin">
      <div class="storm-centroid-radar-ring"></div>
      <div class="storm-centroid-core"><i class="fa-solid fa-radiation"></i></div>
      <div class="storm-centroid-pill">${Math.round(currentCentroid.maxDbz)} dBZ</div>
    </div>
  `;
  const centroidIcon = L.divIcon({
    className: 'storm-centroid-div-icon',
    html: centroidHtml,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  if (!stormCentroidMarker) {
    stormCentroidMarker = L.marker([currentCentroid.lat, currentCentroid.lng], { icon: centroidIcon, zIndexOffset: 800 }).addTo(map);
  } else {
    stormCentroidMarker.setLatLng([currentCentroid.lat, currentCentroid.lng]);
    stormCentroidMarker.setIcon(centroidIcon);
    if (!map.hasLayer(stormCentroidMarker)) stormCentroidMarker.addTo(map);
  }

  stormCentroidMarker.bindTooltip(`
    <div style="font-family: var(--font-tactical); font-size: 11px; padding: 3px 6px;">
      <strong style="color: #ef4444;">🎯 จุดศูนย์กลางกลุ่มฝน (STORM CENTROID)</strong><br>
      ความเข้มสูงสุด: <b>${currentCentroid.maxDbz} dBZ</b><br>
      ความเร็ว: <b>${speedKmh > 0 ? speedKmh + ' km/h' : 'เกือบหยุดนิ่ง'}</b> (${compassStr})<br>
      ระยะห่าง: <b>${currentCentroid.distToHome} km</b> จาก${currentStationName}
    </div>
  `, { direction: 'top', offset: [0, -16] });

  // 9. Geodesic Vectoring & Dynamic ETA Calculation:
  // ETA (minutes) = (Distance_to_Target / Speed) * 60
  const bearingToHome = calculateBearing(currentCentroid.lat, currentCentroid.lng, homeLat, homeLng);
  let angleDiff = Math.abs(bearingDeg - bearingToHome);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  const crossTrackDist = currentCentroid.distToHome * Math.sin(angleDiff * Math.PI / 180);
  const vClosing = speedKmh * Math.cos(angleDiff * Math.PI / 180);

  latestStormTrackingData = {
    speedKmh,
    bearingDeg,
    compassStr,
    distToHome: currentCentroid.distToHome,
    maxDbz: currentCentroid.maxDbz,
    isApproaching: false,
    isRainingNow: false
  };

  const isSevere = currentCentroid.maxDbz >= WARNING_THRESHOLD_DBZ;

  // Branch A: Already inside 5 KM Perimeter
  if (currentCentroid.distToHome <= 5.0) {
    const effectiveSpeed = Math.max(speedKmh, 5);
    const etaMinutes = Math.max(1, Math.round((currentCentroid.distToHome / effectiveSpeed) * 60));
    currentPredictedEta = new Date(Date.now() + etaMinutes * 60 * 1000);
    const etaClockStr = formatDateTimeString(currentPredictedEta).split(' ')[1];
    const etaTimeStr = `${etaClockStr} น. (อีก ~${etaMinutes} นาที / ในระยะ 5 กม.)`;
    latestStormTrackingData.isApproaching = true;

    if (stormInterceptMarker && map.hasLayer(stormInterceptMarker)) {
      map.removeLayer(stormInterceptMarker);
    }

    if (isSevere) {
      updateTacticalStormCard({
        alertState: 'warning',
        title: '🔴 เตือนภัยพายุ: กลุ่มฝนรุนแรง (>= 35 dBZ) จะเข้าสู่ระยะปะทะภายใน 20 นาที!',
        desc: `ความเข้มสูงสุด: ${currentCentroid.maxDbz} dBZ | ความเร็ว: ${speedKmh} km/h (${compassStr}) | เข้าสู่ระยะ 5 กม. แล้ว (${etaClockStr} น.)`,
        badge: 'WARNING // IN 5KM ZONE',
        headerText: '🔴 เตือนภัยพายุ (ในระยะ 5 กม.)'
      });
      updateEtaUI({
        badgeText: 'CRITICAL // เข้าสู่ระยะ 5 KM แล้ว',
        badgeClass: 'badge-critical',
        etaTimeStr: etaTimeStr,
        countdownHtml: `ตรวจพบกลุ่มฝนเคลื่อนตัวด้วยความเร็ว <b>${speedKmh} km/h</b> ทิศทาง <b>${compassStr}</b><br><span style="color: #ef4444; font-weight: 700;">⚠️ กลุ่มฝนรุนแรงความเข้ม ${currentCentroid.maxDbz} dBZ อยู่ในระยะปะทะ 5 km แล้ว</span>`
      });
    } else {
      updateTacticalStormCard({
        alertState: 'watch',
        title: '🟡 เฝ้าระวัง: กลุ่มฝนกำลังเคลื่อนตัวเข้าหา (อยู่ในระยะ 5 กม.)',
        desc: `ความเข้มสูงสุด: ${currentCentroid.maxDbz} dBZ | ระยะห่าง: ${currentCentroid.distToHome} km | ความเร็ว: ${speedKmh} km/h (${compassStr})`,
        badge: `WATCH // ${Math.round(currentCentroid.maxDbz)} dBZ`,
        headerText: `🟡 เฝ้าระวังฝน (${currentCentroid.distToHome} กม.)`
      });
      updateEtaUI({
        badgeText: 'WATCH // IN 5KM ZONE',
        badgeClass: 'badge-warning',
        etaTimeStr: etaTimeStr,
        countdownHtml: `ตรวจพบกลุ่มฝนความเข้ม ${currentCentroid.maxDbz} dBZ อยู่ในระยะ 5 km จากสถานี`
      });
    }
  }
  // Branch B: Approaching towards Target Pin
  else if (vClosing > 1 && angleDiff < 75 && crossTrackDist <= 12) {
    const effectiveSpeed = Math.max(speedKmh, 5);
    // Standard Geodesic ETA formula: ETA (minutes) = (Distance_to_Target / Speed) * 60
    const etaMinutes = Math.max(1, Math.round((currentCentroid.distToHome / effectiveSpeed) * 60));
    currentPredictedEta = new Date(Date.now() + etaMinutes * 60 * 1000);
    const etaClockStr = formatDateTimeString(currentPredictedEta).split(' ')[1];
    const etaTimeStr = `${etaClockStr} น. (อีก ~${etaMinutes} นาที)`;
    latestStormTrackingData.isApproaching = true;

    // Render / Update Tactical Intercept Reticle Pin along trajectory
    const distToIntercept = Math.max(0.5, currentCentroid.distToHome - 5.0);
    const [interceptLat, interceptLon] = destinationPoint(currentCentroid.lat, currentCentroid.lng, bearingDeg, distToIntercept);
    const interceptHtml = `
      <div class="storm-intercept-pin">
        <div class="intercept-reticle-ring"></div>
        <div class="intercept-core"><i class="fa-solid fa-bullseye"></i></div>
        <div class="intercept-pill">ETA: ~${etaMinutes}m</div>
      </div>
    `;
    const interceptIcon = L.divIcon({
      className: 'storm-intercept-div-icon',
      html: interceptHtml,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    if (!stormInterceptMarker) {
      stormInterceptMarker = L.marker([interceptLat, interceptLon], { icon: interceptIcon, zIndexOffset: 750 }).addTo(map);
    } else {
      stormInterceptMarker.setLatLng([interceptLat, interceptLon]);
      stormInterceptMarker.setIcon(interceptIcon);
      if (!map.hasLayer(stormInterceptMarker)) stormInterceptMarker.addTo(map);
    }

    stormInterceptMarker.bindTooltip(`
      <div style="font-family: var(--font-tactical); font-size: 11px; padding: 3px 6px;">
        <strong style="color: #f59e0b;">🎯 จุดคาดการณ์ปะทะระยะ 5 กม. (INTERCEPT POINT)</strong><br>
        เวลาคาดการณ์ (ETA): <b>อีก ~${etaMinutes} นาที (${etaClockStr} น.)</b><br>
        ความเร็วพายุ: <b>${speedKmh} km/h</b> (${compassStr})
      </div>
    `, { direction: 'top', offset: [0, -18] });

    // Dual-Threshold Alert Assignment:
    // Red Warning: >= 35 dBZ and ETA <= 20 min
    // Yellow Watch: ETA > 20 min or < 35 dBZ
    if (isSevere && etaMinutes <= 20) {
      updateTacticalStormCard({
        alertState: 'warning',
        title: '🔴 เตือนภัยพายุ: กลุ่มฝนรุนแรง (>= 35 dBZ) จะเข้าสู่ระยะปะทะภายใน 20 นาที!',
        desc: `ความเข้มสูงสุด: ${currentCentroid.maxDbz} dBZ | ความเร็ว: ${speedKmh} km/h (${compassStr}) | คาดการณ์ปะทะ: อีก ~${etaMinutes} นาที (${etaClockStr} น.)`,
        badge: `WARNING // ${etaMinutes} MIN`,
        headerText: `🔴 เตือนภัยพายุ (อีก ~${etaMinutes} นาที)`
      });
      updateEtaUI({
        badgeText: `CRITICAL (อีก ${etaMinutes} นาที)`,
        badgeClass: 'badge-critical',
        etaTimeStr: etaTimeStr,
        countdownHtml: `ตรวจพบกลุ่มฝนรุนแรงเคลื่อนตัวด้วยความเร็ว <b>${speedKmh} km/h</b> ทิศทาง <b>${compassStr}</b> (ห่าง <b>${currentCentroid.distToHome} km</b>)<br><span style="color: #ef4444; font-weight: 700;">⚠️ กลุ่มฝนรุนแรงความเข้ม ${currentCentroid.maxDbz} dBZ จะเข้าสู่ระยะปะทะในอีก ${etaMinutes} นาที!</span>`
      });
    } else {
      updateTacticalStormCard({
        alertState: 'watch',
        title: '🟡 เฝ้าระวัง: กลุ่มฝนกำลังเคลื่อนตัวเข้าหา (ETA > 20 นาที)',
        desc: `ความเข้มสูงสุด: ${currentCentroid.maxDbz} dBZ | ความเร็ว: ${speedKmh} km/h (${compassStr}) | คาดการณ์ปะทะ: อีก ~${etaMinutes} นาที (${etaClockStr} น.)`,
        badge: `WATCH // ${etaMinutes} MIN`,
        headerText: `🟡 เฝ้าระวัง (อีก ~${etaMinutes} นาที)`
      });
      updateEtaUI({
        badgeText: `APPROACHING (อีก ${etaMinutes} นาที)`,
        badgeClass: 'badge-warning',
        etaTimeStr: etaTimeStr,
        countdownHtml: `ตรวจพบกลุ่มฝนเคลื่อนตัวด้วยความเร็ว <b>${speedKmh} km/h</b> ทิศทาง <b>${compassStr}</b> (ห่าง <b>${currentCentroid.distToHome} km</b>)<br><span style="color: #f59e0b; font-weight: 700;">ETA: คาดว่าจะเข้าสู่ระยะปะทะในอีก ${etaMinutes} นาที (${etaClockStr} น.)</span>`
      });
    }
  }
  // Branch C: Quasi-Stationary (< 3 km/h)
  else if (speedKmh < 3) {
    currentPredictedEta = null;
    if (stormInterceptMarker && map.hasLayer(stormInterceptMarker)) {
      map.removeLayer(stormInterceptMarker);
    }

    updateTacticalStormCard({
      alertState: 'watch',
      title: `🟡 เฝ้าระวัง: กลุ่มฝนสะสมตัวเกือบหยุดนิ่ง (< 3 km/h) ห่าง ${currentCentroid.distToHome} กม.`,
      desc: `ความเข้มสูงสุด: ${currentCentroid.maxDbz} dBZ | เฝ้าระวังการสะสมปริมาณน้ำฝนในรัศมีใกล้เคียง`,
      badge: 'WATCH // STATIONARY',
      headerText: `🟡 ฝนสะสมตัว (${currentCentroid.distToHome} กม.)`
    });

    updateEtaUI({
      badgeText: 'QUASI-STATIONARY',
      badgeClass: 'badge-warning',
      etaTimeStr: 'เกือบหยุดนิ่ง / สะสมตัว',
      countdownHtml: `ตรวจพบกลุ่มฝนสะสมตัวเกือบหยุดนิ่ง (ความเร็ว <b>< 3 km/h</b>) ห่างออกไป <b>${currentCentroid.distToHome} km</b> (${compassStr})<br>เฝ้าระวังการสะสมปริมาณน้ำฝนในรัศมีใกล้เคียง`
    });
  }
  // Branch D: Moving Away or Passing by outside perimeter
  else {
    currentPredictedEta = null;
    if (stormInterceptMarker && map.hasLayer(stormInterceptMarker)) {
      map.removeLayer(stormInterceptMarker);
    }

    updateTacticalStormCard({
      alertState: 'watch',
      title: `🟡 ตรวจพบกลุ่มฝน - เคลื่อนตัวออกห่าง หรือผ่านไปทาง ${compassStr} (${currentCentroid.distToHome} กม.)`,
      desc: `ความเข้มสูงสุด: ${currentCentroid.maxDbz} dBZ | ความเร็ว: ${speedKmh} km/h | ไม่พบแนวโน้มปะทะเป้าหมายโดยตรง`,
      badge: `PASSING // ${Math.round(currentCentroid.maxDbz)} dBZ`,
      headerText: `🟡 กลุ่มฝนผ่าน (${currentCentroid.distToHome} กม.)`
    });

    updateEtaUI({
      badgeText: 'PASSING BY',
      badgeClass: 'badge-clear',
      etaTimeStr: `เคลื่อนตัวไปทาง ${compassStr}`,
      countdownHtml: `ตรวจพบกลุ่มฝนความเข้ม <b>${currentCentroid.maxDbz} dBZ</b> กำลังเคลื่อนที่ไปทาง <b>${compassStr}</b> (${speedKmh} km/h)<br>ทิศทางไม่ส่งผลกระทบต่อเป้าหมายโดยตรง`
    });
  }
}

/**
 * Updates UI DOM elements for Predicted Rain Arrival & Tactical Alert Panel
 */
function updateEtaUI({ badgeText, badgeColor, badgeClass, etaTimeStr, countdownHtml }) {
  if (predictedEtaDisplay) predictedEtaDisplay.textContent = etaTimeStr;
  if (mobilePredictedEtaDisplay) mobilePredictedEtaDisplay.textContent = etaTimeStr;

  if (etaCountdownText) etaCountdownText.innerHTML = countdownHtml;
  if (mobileEtaCountdownText) mobileEtaCountdownText.innerHTML = countdownHtml;

  if (etaStateBadge) {
    etaStateBadge.textContent = badgeText;
    etaStateBadge.className = `eta-badge ${badgeClass || ''}`;
    if (badgeColor) etaStateBadge.style.color = badgeColor;
  }
  if (mobileEtaStateBadge) {
    mobileEtaStateBadge.textContent = badgeText;
    mobileEtaStateBadge.className = `eta-badge ${badgeClass || ''}`;
    if (badgeColor) mobileEtaStateBadge.style.color = badgeColor;
  }

  if (modalPredictedEta) {
    modalPredictedEta.textContent = currentPredictedEta ? formatDateTimeString(currentPredictedEta) : 'ไม่มีสัญญาณฝนตกหนัก';
  }
}

/**
 * 1-second interval countdown ticker for active approaching storm
 */
function updateEtaDisplay() {
  if (!currentPredictedEta || !latestStormTrackingData || !latestStormTrackingData.isApproaching) return;

  const now = new Date();
  const diffMs = currentPredictedEta.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);

  const tracking = latestStormTrackingData;

  if (diffMs > 0) {
    const countdownHtml = `ตรวจพบกลุ่มฝนเคลื่อนตัวด้วยความเร็ว <b>${tracking.speedKmh} km/h</b> ทิศทาง <b>${tracking.compassStr}</b> (ห่าง <b>${tracking.distToHome} km</b>)<br><span style="color: #f59e0b; font-weight: 700;">ETA: คาดว่าจะเข้าสู่ระยะ 5 km ในอีก <b>${diffMins} นาที ${diffSecs} วินาที</b></span>`;
    if (etaCountdownText) etaCountdownText.innerHTML = countdownHtml;
    if (mobileEtaCountdownText) mobileEtaCountdownText.innerHTML = countdownHtml;

    // Synchronize intercept marker pill if marker is present
    if (stormInterceptMarker) {
      const el = stormInterceptMarker.getElement();
      const pill = el ? el.querySelector('.intercept-pill') : null;
      if (pill) {
        pill.textContent = `ETA: ~${Math.max(1, Math.ceil(diffMs / 60000))}m`;
      }
    }
  } else {
    const overdueMins = Math.abs(diffMins);
    const countdownHtml = `ตรวจพบกลุ่มฝนเคลื่อนตัวด้วยความเร็ว <b>${tracking.speedKmh} km/h</b> ทิศทาง <b>${tracking.compassStr}</b><br><span style="color: #ef4444; font-weight: 700;">⚠️ เข้าสู่ระยะ 5 km แล้ว (ผ่านเวลาคาดการณ์มา ${overdueMins} นาที)</span>`;
    if (etaCountdownText) etaCountdownText.innerHTML = countdownHtml;
    if (mobileEtaCountdownText) mobileEtaCountdownText.innerHTML = countdownHtml;
    if (etaStateBadge) {
      etaStateBadge.textContent = "CRITICAL // IN 5KM ZONE";
      etaStateBadge.className = "eta-badge badge-critical";
    }
    if (mobileEtaStateBadge) {
      mobileEtaStateBadge.textContent = "CRITICAL // IN 5KM ZONE";
      mobileEtaStateBadge.className = "eta-badge badge-critical";
    }

    if (tracking.maxDbz >= 34.5) {
      updateTacticalStormCard({
        alertState: 'warning',
        title: '🔴 เตือนภัยพายุเข้า - เมฆฝนหนาแน่น (≥ 35 dBZ) เข้าสู่ระยะ 5 กม. แล้ว',
        desc: `ความเข้มสูงสุด: ${tracking.maxDbz} dBZ | ความเร็ว: ${tracking.speedKmh} km/h (${tracking.compassStr}) | เตรียมรับมือฝนตกหนัก`,
        badge: 'WARNING // 5KM ZONE',
        headerText: '🔴 วิกฤต: ในระยะ 5 กม.'
      });
    }
  }
}

function initRainPredictionETA() {
  scheduleStormTrackerAnalysis(currentFrameIndex);
  setInterval(updateEtaDisplay, 1000);
}

// --- 11. GROUND-TRUTH FEEDBACK & PRECISION REPORTING FLOW ---
let pendingDecisionType = null;
let isSubmittingGroundTruth = false;

function openFeedbackModal() {
  const now = new Date();
  if (modalCoords) modalCoords.textContent = `${currentCoords[0].toFixed(4)}, ${currentCoords[1].toFixed(4)} (${currentStationName})`;
  if (modalPredictedEta) modalPredictedEta.textContent = currentPredictedEta ? formatDateTimeString(currentPredictedEta) : formatDateTimeString(now);
  if (modalCurrentTime) modalCurrentTime.textContent = formatDateTimeString(now);
  if (modalWeatherSummary) modalWeatherSummary.textContent = activeWeatherSummary;
  if (modalStatusFeedback) {
    modalStatusFeedback.textContent = "เลือกปุ่มด้านบนเพื่อส่งข้อมูล";
    modalStatusFeedback.style.color = "#94a3b8";
  }

  setReportingButtonsDisabled(false);
  isSubmittingGroundTruth = false;
  pendingDecisionType = null;

  if (feedbackModalBackdrop) {
    feedbackModalBackdrop.classList.add('is-open');
    feedbackModalBackdrop.setAttribute('aria-hidden', 'false');
  }
  if (openFeedbackModalBtn) openFeedbackModalBtn.setAttribute('aria-expanded', 'true');
}

function closeFeedbackModal() {
  if (feedbackModalBackdrop) {
    feedbackModalBackdrop.classList.remove('is-open');
    feedbackModalBackdrop.setAttribute('aria-hidden', 'true');
  }
  if (openFeedbackModalBtn) openFeedbackModalBtn.setAttribute('aria-expanded', 'false');
  if (gtConfirmBackdrop) {
    gtConfirmBackdrop.classList.remove('is-open');
    gtConfirmBackdrop.setAttribute('aria-hidden', 'true');
  }
  setReportingButtonsDisabled(false);
  isSubmittingGroundTruth = false;
  pendingDecisionType = null;
}

/** Disable or enable all reporting buttons across desktop modal and mobile drawer */
function setReportingButtonsDisabled(disabled) {
  const reportBtns = [
    feedbackEarlyBtn,
    feedbackDelayedBtn,
    feedbackFalseAlarmBtn,
    drawerFeedbackEarlyBtn,
    drawerFeedbackDelayedBtn,
    drawerFeedbackFalseAlarmBtn
  ];
  reportBtns.forEach(btn => {
    if (btn) {
      btn.disabled = disabled;
      btn.classList.toggle('is-disabled', disabled);
    }
  });
}

/** Step 1: Intercept click on reporting buttons and open 2-step verification dialog */
function initiateGroundTruthReport(decisionType) {
  if (isSubmittingGroundTruth) return;
  pendingDecisionType = decisionType;

  // Decision preview configurations
  const metaConfig = {
    early: {
      badgeText: '🟢 1. ฝนเริ่มตกแล้ว',
      badgeClass: 'status-early',
      title: 'ฝนตกจริง (Early Arrival)',
      accentColor: '#10b981'
    },
    delayed: {
      badgeText: '🟡 2. ตกช้ากว่าพยากรณ์',
      badgeClass: 'status-delayed',
      title: 'ล่าช้ากว่าคาด (Delayed Arrival)',
      accentColor: '#f59e0b'
    },
    false_alarm: {
      badgeText: '🔴 3. เมฆผ่านไปแล้ว / ไม่ตกจริง',
      badgeClass: 'status-false-alarm',
      title: 'False Alarm (ไม่ตกจริง)',
      accentColor: '#ef4444'
    }
  };

  const cfg = metaConfig[decisionType] || metaConfig.early;
  const now = new Date();
  const nowStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const etaStr = currentPredictedEta ? formatDateTimeString(currentPredictedEta) : "ไม่มีเป้าหมายฝน";

  // Branch A: Primary SweetAlert2 Tactical Modal (If available)
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'ยืนยันการส่งรายงานสถานการณ์พื้นที่จริงหรือไม่?',
      html: `
        <div style="text-align:center; padding: 4px 0 10px 0;">
          <div class="preview-badge ${cfg.badgeClass}" style="display:inline-block; margin-bottom:12px; font-size:15px; font-weight:700;">
            ${cfg.badgeText}
          </div>
          <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; padding: 10px 14px; font-family: var(--font-mono); font-size: 12px; color: #94a3b8; text-align: left; line-height: 1.6;">
            <div><i class="fa-solid fa-location-dot" style="color:#06b6d4; width:18px;"></i> <b>พิกัด:</b> [${currentCoords[0].toFixed(3)}, ${currentCoords[1].toFixed(3)}] (${currentStationName})</div>
            <div><i class="fa-solid fa-clock" style="color:#10b981; width:18px;"></i> <b>เวลาจริง:</b> ${nowStr}</div>
            <div><i class="fa-solid fa-crosshairs" style="color:#f59e0b; width:18px;"></i> <b>เป้าหมาย ETA:</b> ${etaStr}</div>
          </div>
          <p style="margin-top:14px; font-size:13px; color:#94a3b8;">
            โปรดตรวจสอบสถานะก่อนส่งข้อมูลเข้าสู่ระบบศูนย์กลาง (Google Sheets)
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-check"></i> ยืนยัน (Confirm)',
      cancelButtonText: '<i class="fa-solid fa-xmark"></i> ยกเลิก (Cancel)',
      reverseButtons: true,
      focusCancel: false,
      customClass: {
        popup: 'swal2-tactical-popup',
        confirmButton: 'swal2-tactical-confirm-btn',
        cancelButton: 'swal2-tactical-cancel-btn'
      }
    }).then((result) => {
      if (result.isConfirmed) {
        executeGroundTruthReport();
      } else {
        cancelGroundTruthReport();
      }
    });
    return;
  }

  // Branch B: Custom DOM Modal Fallback (If SweetAlert2 is offline/blocked)
  if (gtPreviewBadge) {
    gtPreviewBadge.textContent = cfg.badgeText;
    gtPreviewBadge.className = `preview-badge ${cfg.badgeClass}`;
  }

  if (gtPreviewMeta) {
    gtPreviewMeta.textContent = `📍 [${currentCoords[0].toFixed(3)}, ${currentCoords[1].toFixed(3)}] | ⏱️ เวลาจริง: ${nowStr} | 🎯 ETA: ${etaStr}`;
  }

  // Reset confirmation modal views
  if (gtPromptView) gtPromptView.style.display = 'flex';
  if (gtLoadingView) gtLoadingView.style.display = 'none';
  if (gtResultView) gtResultView.style.display = 'none';
  if (gtResultActions) gtResultActions.style.display = 'none';
  if (gtConfirmBtn) gtConfirmBtn.disabled = false;
  if (gtCancelBtn) gtCancelBtn.disabled = false;

  if (gtConfirmBackdrop) {
    gtConfirmBackdrop.classList.add('is-open');
    gtConfirmBackdrop.setAttribute('aria-hidden', 'false');
  }
}

/** Step 1 Cancel: User cancels report transmission */
function cancelGroundTruthReport() {
  if (isSubmittingGroundTruth) return; // Prevent canceling during active transmission lock
  pendingDecisionType = null;
  if (gtConfirmBackdrop) {
    gtConfirmBackdrop.classList.remove('is-open');
    gtConfirmBackdrop.setAttribute('aria-hidden', 'true');
  }
  setReportingButtonsDisabled(false);
}

/** Step 2 & 3: Anti-spam lock, 3-second countdown delay & concurrent webhook execution */
async function executeGroundTruthReport() {
  if (isSubmittingGroundTruth || !pendingDecisionType) return;
  isSubmittingGroundTruth = true;

  // 1. Immediately DISABLE all reporting buttons to prevent double-clicking/spam
  setReportingButtonsDisabled(true);
  if (gtConfirmBtn) gtConfirmBtn.disabled = true;
  if (gtCancelBtn) gtCancelBtn.disabled = true;

  // Calculate telemetry payload
  const actualArrivalDate = new Date();
  const actualArrivalStr = formatDateTimeString(actualArrivalDate);
  const predictedEtaDate = currentPredictedEta || actualArrivalDate;
  const predictedEtaStr = formatDateTimeString(predictedEtaDate);

  let deltaMinutes = 0;
  let deltaSeconds = 0;
  let status = "Test Signal";

  if (pendingDecisionType === 'early' || pendingDecisionType === 'delayed') {
    const totalDiffSecs = Math.round((actualArrivalDate.getTime() - predictedEtaDate.getTime()) / 1000);
    deltaMinutes = Math.trunc(totalDiffSecs / 60);
    deltaSeconds = totalDiffSecs % 60;
    status = totalDiffSecs < 0 ? "Early Arrival" : "Delayed Arrival";
  } else if (pendingDecisionType === 'false_alarm') {
    status = "False Alarm";
    deltaMinutes = 0;
    deltaSeconds = 0;
  }

  const payload = {
    latitude: currentCoords[0],
    longitude: currentCoords[1],
    predictedEta: predictedEtaStr,
    actualArrival: actualArrivalStr,
    deltaMinutes: deltaMinutes,
    deltaSeconds: deltaSeconds,
    status: status,
    weatherSummary: activeWeatherSummary
  };

  const COUNTDOWN_SECONDS = 3;

  // Concurrently execute background Webhook fetch
  const fetchPromise = (async () => {
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      return { ok: true };
    } catch (err) {
      console.error('Webhook dispatch error:', err);
      return { ok: false, error: err };
    }
  })();

  // -------------------------------------------------------------
  // BRANCH A: SweetAlert2 Mode (Smooth Tactical Animation)
  // -------------------------------------------------------------
  if (typeof Swal !== 'undefined') {
    let timerInterval;
    Swal.fire({
      title: 'กำลังส่งข้อมูลไปยังระบบศูนย์กลาง...',
      html: `
        <div style="text-align:center; padding: 10px 0;">
          <div class="gt-loading-pulse-ring" style="margin: 0 auto 16px auto;">
            <div class="gt-countdown-circle">
              <span id="swalCountdownNumber" class="gt-countdown-number">${COUNTDOWN_SECONDS}</span>
            </div>
          </div>
          <p class="gt-loading-subtext" style="margin-bottom:14px; font-size:13px; color:#94a3b8;">
            <i class="fa-solid fa-lock" style="color:#06b6d4;"></i> ระบบป้องกันการส่งซ้ำ (Anti-Spam Security Lock) กำลังทำงาน
          </p>
          <div class="gt-progress-bar-wrap" style="width:100%; height:6px; background:rgba(30,41,59,0.8); border-radius:4px; overflow:hidden;">
            <div class="gt-progress-bar-fill" id="swalProgressFill" style="width:0%; height:100%; background:linear-gradient(90deg, #06b6d4, #10b981); transition:width 0.1s linear;"></div>
          </div>
        </div>
      `,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      customClass: {
        popup: 'swal2-tactical-popup'
      },
      didOpen: () => {
        const numElem = document.getElementById('swalCountdownNumber');
        const barElem = document.getElementById('swalProgressFill');
        const startTime = Date.now();
        const duration = COUNTDOWN_SECONDS * 1000;

        timerInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(100, (elapsed / duration) * 100);
          if (barElem) barElem.style.width = `${progress}%`;

          const remaining = Math.max(1, Math.ceil((duration - elapsed) / 1000));
          if (numElem) numElem.textContent = remaining;

          if (elapsed >= duration) {
            clearInterval(timerInterval);
            if (numElem) numElem.textContent = '1';
            if (barElem) barElem.style.width = '100%';
          }
        }, 100);
      },
      willClose: () => {
        clearInterval(timerInterval);
      }
    });

    const countdownPromise = new Promise(resolve => setTimeout(resolve, COUNTDOWN_SECONDS * 1000));
    const [, fetchResult] = await Promise.all([countdownPromise, fetchPromise]);

    if (fetchResult && fetchResult.ok) {
      if (modalStatusFeedback) {
        modalStatusFeedback.innerHTML = `✅ ส่งข้อมูลสถานะ "${payload.status}" ไปยังฐานข้อมูลสำเร็จ!`;
        modalStatusFeedback.style.color = '#34d399';
      }

      showToast(
        '📡 ข้อมูลถูกส่งเข้าฐานข้อมูล Google Sheets สำเร็จ!',
        `สถานะ: ${payload.status} | ส่วนต่าง: ${payload.deltaMinutes}m ${payload.deltaSeconds}s`
      );

      await Swal.fire({
        icon: 'success',
        title: '✅ รายงานสำเร็จ!',
        html: `
          <div style="text-align:center; padding: 6px 0;">
            <p style="color:#34d399; font-weight:700; font-size:16px; margin-bottom:8px;">
              บันทึกข้อมูลภาคพื้นดินเรียบร้อย
            </p>
            <p style="color:#94a3b8; font-size:13px; line-height:1.6;">
              สถานะ: <b>"${payload.status}"</b><br>
              ส่วนต่างเวลา: <b>${payload.deltaMinutes} นาที ${payload.deltaSeconds} วินาที</b><br>
              <span style="color:#06b6d4;">บันทึกเข้า Google Sheets สำเร็จ</span>
            </p>
          </div>
        `,
        timer: 2000,
        showConfirmButton: false,
        customClass: {
          popup: 'swal2-tactical-popup'
        }
      });

      closeFeedbackModal();
      closeMobileDrawer();
      setReportingButtonsDisabled(false);
      isSubmittingGroundTruth = false;
      pendingDecisionType = null;

    } else {
      if (modalStatusFeedback) {
        modalStatusFeedback.innerHTML = '❌ การส่งข้อมูลล้มเหลว';
        modalStatusFeedback.style.color = '#f43f5e';
      }

      showToast('❌ ไม่สามารถส่งข้อมูล Webhook ได้', 'โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');

      await Swal.fire({
        icon: 'error',
        title: '❌ การส่งข้อมูลล้มเหลว',
        html: `
          <div style="text-align:center; padding: 6px 0;">
            <p style="color:#f43f5e; font-weight:700; margin-bottom:6px;">
              ไม่สามารถเชื่อมต่อ Google Apps Script Webhook ได้
            </p>
            <p style="color:#94a3b8; font-size:13px;">
              โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วลองใหม่อีกครั้ง
            </p>
          </div>
        `,
        timer: 2000,
        showConfirmButton: false,
        customClass: {
          popup: 'swal2-tactical-popup'
        }
      });

      closeFeedbackModal();
      closeMobileDrawer();
      setReportingButtonsDisabled(false);
      isSubmittingGroundTruth = false;
      pendingDecisionType = null;
    }
    return;
  }

  // -------------------------------------------------------------
  // BRANCH B: Custom DOM Modal Fallback Mode
  // -------------------------------------------------------------
  // Switch to View 2: Loading & Countdown Overlay
  if (gtPromptView) gtPromptView.style.display = 'none';
  if (gtLoadingView) gtLoadingView.style.display = 'flex';
  if (gtResultView) gtResultView.style.display = 'none';

  // Visible 3-second countdown timer (3... 2... 1...)
  if (gtCountdownNumber) gtCountdownNumber.textContent = COUNTDOWN_SECONDS;
  if (gtProgressFill) gtProgressFill.style.width = '0%';

  const domCountdownPromise = new Promise((resolve) => {
    const startTime = Date.now();
    const duration = COUNTDOWN_SECONDS * 1000;

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, (elapsed / duration) * 100);
      if (gtProgressFill) gtProgressFill.style.width = `${progress}%`;

      const remaining = Math.max(1, Math.ceil((duration - elapsed) / 1000));
      if (gtCountdownNumber) gtCountdownNumber.textContent = remaining;

      if (elapsed >= duration) {
        clearInterval(timer);
        if (gtCountdownNumber) gtCountdownNumber.textContent = '1';
        if (gtProgressFill) gtProgressFill.style.width = '100%';
        resolve();
      }
    }, 100);
  });

  // Concurrently await both the 3-second countdown and fetch response
  const [, domFetchResult] = await Promise.all([domCountdownPromise, fetchPromise]);

  // Step 3: Success / Failure Feedback
  if (gtLoadingView) gtLoadingView.style.display = 'none';
  if (gtResultView) gtResultView.style.display = 'flex';

  if (domFetchResult && domFetchResult.ok) {
    // Success State
    if (gtResultIconBox) {
      gtResultIconBox.className = 'gt-result-icon-box success';
      gtResultIconBox.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    }
    if (gtResultTitle) {
      gtResultTitle.textContent = '✅ รายงานสำเร็จ!';
      gtResultTitle.style.color = '#34d399';
    }
    if (gtResultSubtext) {
      gtResultSubtext.textContent = `สถานะ: "${payload.status}" | ส่วนต่าง: ${payload.deltaMinutes}m ${payload.deltaSeconds}s | บันทึกเข้า Google Sheets สำเร็จ`;
    }
    if (modalStatusFeedback) {
      modalStatusFeedback.innerHTML = `✅ ส่งข้อมูลสถานะ "${payload.status}" ไปยังฐานข้อมูลสำเร็จ!`;
      modalStatusFeedback.style.color = '#34d399';
    }
    if (gtResultActions) gtResultActions.style.display = 'none';

    showToast(
      '📡 ข้อมูลถูกส่งเข้าฐานข้อมูล Google Sheets สำเร็จ!',
      `สถานะ: ${payload.status} | ส่วนต่าง: ${payload.deltaMinutes}m ${payload.deltaSeconds}s`
    );

    // Auto-close the entire Ground-Truth modal after 2 seconds and reset button states
    setTimeout(() => {
      if (gtConfirmBackdrop) {
        gtConfirmBackdrop.classList.remove('is-open');
        gtConfirmBackdrop.setAttribute('aria-hidden', 'true');
      }
      closeFeedbackModal();
      closeMobileDrawer();
      setReportingButtonsDisabled(false);
      isSubmittingGroundTruth = false;
      pendingDecisionType = null;
    }, 2000);

  } else {
    // Failure State
    if (gtResultIconBox) {
      gtResultIconBox.className = 'gt-result-icon-box error';
      gtResultIconBox.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    }
    if (gtResultTitle) {
      gtResultTitle.textContent = '❌ การส่งข้อมูลล้มเหลว';
      gtResultTitle.style.color = '#f43f5e';
    }
    if (gtResultSubtext) {
      gtResultSubtext.textContent = 'ไม่สามารถเชื่อมต่อ Google Apps Script Webhook ได้ โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';
    }
    if (modalStatusFeedback) {
      modalStatusFeedback.innerHTML = '❌ การส่งข้อมูลล้มเหลว';
      modalStatusFeedback.style.color = '#f43f5e';
    }
    if (gtResultActions) gtResultActions.style.display = 'none';

    showToast('❌ ไม่สามารถส่งข้อมูล Webhook ได้', 'โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');

    setTimeout(() => {
      if (gtConfirmBackdrop) {
        gtConfirmBackdrop.classList.remove('is-open');
        gtConfirmBackdrop.setAttribute('aria-hidden', 'true');
      }
      closeFeedbackModal();
      closeMobileDrawer();
      setReportingButtonsDisabled(false);
      isSubmittingGroundTruth = false;
      pendingDecisionType = null;
    }, 2000);
  }
}

function showToast(title, message) {
  const toast = document.createElement('div');
  toast.className = 'tactical-toast';
  toast.innerHTML = `
    <i class="fa-solid fa-satellite-dish toast-icon"></i>
    <div class="toast-content">
      <span class="toast-title">${title}</span>
      <span class="toast-msg">${message}</span>
    </div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// --- 12. GEOLOCATION & STATION CONTROLS ---
function locateUser() {
  if (!navigator.geolocation) {
    showToast('⚠️ ระบบไม่รองรับ Geolocation', 'เบราว์เซอร์นี้ไม่รองรับการค้นหาตำแหน่งจริง');
    return;
  }

  showToast('🛰️ กำลังค้นหาตำแหน่ง GPS...', 'โปรดอนุญาตการเข้าถึงตำแหน่งที่ตั้งในเบราว์เซอร์');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      currentCoords = [lat, lon];
      currentStationName = "พิกัดผู้ใช้ปัจจุบัน (User GPS Location)";

      const coordsStr = `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E`;
      if (coordsDisplay) coordsDisplay.textContent = coordsStr;
      if (coordsDisplayLat) coordsDisplayLat.textContent = `${lat.toFixed(4)}° N,`;
      if (coordsDisplayLon) coordsDisplayLon.textContent = `${lon.toFixed(4)}° E`;
      if (mobileCoordsDisplay) mobileCoordsDisplay.textContent = coordsStr;
      if (stationNameDisplay) stationNameDisplay.textContent = currentStationName;
      if (mobileStationNameDisplay) mobileStationNameDisplay.textContent = currentStationName;
      if (mobileStationSub) mobileStationSub.textContent = `GPS [${lat.toFixed(2)}, ${lon.toFixed(2)}]`;

      map.setView(currentCoords, 11);
      updateRadarRangeRings(currentCoords);
      if (windArrowMarker) windArrowMarker.setLatLng(currentCoords);
      fetchOpenMeteoWeather(lat, lon);
      scheduleStormTrackerAnalysis(currentFrameIndex);

      showToast('🎯 ปรับพิกัดสำเร็จ!', `ตั้งศูนย์กลางที่ตำแหน่งของคุณ [${lat.toFixed(4)}, ${lon.toFixed(4)}]`);
    },
    (err) => {
      console.warn('Geolocation failed:', err);
      showToast('⚠️ ไม่สามารถระบุพิกัดได้', 'ใช้พิกัดเริ่มต้น: บางกรวย, นนทบุรี');
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function resetToBangKruai() {
  currentCoords = [...DEFAULT_COORDS];
  currentStationName = DEFAULT_STATION_NAME;

  if (coordsDisplay) coordsDisplay.textContent = "13.8050° N, 100.4728° E";
  if (coordsDisplayLat) coordsDisplayLat.textContent = "13.8050° N,";
  if (coordsDisplayLon) coordsDisplayLon.textContent = "100.4728° E";
  if (mobileCoordsDisplay) mobileCoordsDisplay.textContent = "13.8050° N, 100.4728° E";
  if (stationNameDisplay) stationNameDisplay.textContent = currentStationName;
  if (mobileStationNameDisplay) mobileStationNameDisplay.textContent = currentStationName;
  if (mobileStationSub) mobileStationSub.textContent = "บางกรวย, นนทบุรี";

  map.setView(DEFAULT_COORDS, INITIAL_ZOOM);
  updateRadarRangeRings(DEFAULT_COORDS);
  if (windArrowMarker) windArrowMarker.setLatLng(DEFAULT_COORDS);
  fetchOpenMeteoWeather(DEFAULT_COORDS[0], DEFAULT_COORDS[1]);
  scheduleStormTrackerAnalysis(currentFrameIndex);

  showToast('🔄 รีเซ็ตตำแหน่งศูนย์กลาง', 'กลับสู่สถานีบางกรวย นนทบุรี');
}

// --- 13. MINIMAL TACTICAL WIND DIRECTION ARROW MARKER (850 hPa Cloud Steering Level) ---
/**
 * Initializes the tactical wind arrow marker at the specified coordinate (Bang Kruai [13.8050, 100.4728]).
 * Displays a sleek dark-disc marker with a bright cyan/blue navigation arrow.
 */
function initWindArrowMarker(coords = DEFAULT_COORDS) {
  if (!map) return;

  const windArrowIcon = L.divIcon({
    className: 'tactical-wind-marker',
    html: `
      <div class="wind-marker-disc" id="windMarkerDisc" title="ทิศทางกระแสลมระดับเมฆ 850 hPa (Cloud Steering Level)">
        <div class="wind-arrow-rotator" id="windArrowRotator" style="transform: rotate(0deg);">
          <i class="fa-solid fa-location-arrow wind-arrow-icon"></i>
        </div>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });

  if (!windArrowMarker) {
    windArrowMarker = L.marker(coords, {
      icon: windArrowIcon,
      zIndexOffset: 850,
      interactive: true
    }).addTo(map);

    windArrowMarker.bindTooltip('ทิศทางกระแสลมระดับเมฆ 850 hPa (กำลังดึงข้อมูล...)', {
      direction: 'top',
      offset: [0, -22],
      className: 'tactical-tooltip'
    });
  } else {
    windArrowMarker.setLatLng(coords);
  }
}

/**
 * Updates the wind arrow rotation and tooltip using 850 hPa wind data.
 * Wind direction convention: meteorological direction (degrees wind blows FROM).
 * Arrow rotates towards: ((directionDeg + 180) % 360).
 */
function updateWindArrowMarker(speedKmh, directionDeg) {
  wind850SpeedKmh = speedKmh;
  wind850DirectionDeg = directionDeg;

  // Calculate direction wind blows TOWARDS
  const towardsDeg = ((directionDeg + 180) % 360);

  const rotator = document.getElementById('windArrowRotator');
  if (rotator) {
    rotator.style.transform = `rotate(${towardsDeg}deg)`;
  }

  if (windArrowMarker) {
    const tooltipText = `💨 ลมระดับเมฆ 850 hPa: ${speedKmh} km/h<br><span style="color:#38bdf8;">พัดมุ่งหน้า: ${Math.round(towardsDeg)}°</span> (จาก ${Math.round(directionDeg)}°)`;
    windArrowMarker.setTooltipContent(tooltipText);
  }
}

// --- 14. RAIN RATE INSPECTOR (Reticle Target Pin & Tile Pixel Sampling) ---
let rainInspectorPopup = null;
let inspectorReticleMarker = null;

// Tactical Reticle Target Pin DivIcon
const targetPinIcon = L.divIcon({
  className: 'tactical-target-reticle',
  html: `
    <div class="reticle-box">
      <div class="reticle-ring"></div>
      <div class="reticle-cross-h"></div>
      <div class="reticle-cross-v"></div>
      <div class="reticle-center-dot"></div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

// Tactical Radar Color-to-dBZ Polyline Palette (RainViewer Scheme 6 / NEXRAD Level III)
const radarPalette = [
  { dbz: 10, r: 100, g: 200, b: 255 },     // Pale Cyan / Drizzle boundary
  { dbz: 15, r: 1,   g: 160, b: 246 },     // Light Blue
  { dbz: 20, r: 0,   g: 0,   b: 246 },     // Blue
  { dbz: 25, r: 0,   g: 255, b: 0   },     // Light Green
  { dbz: 30, r: 0,   g: 200, b: 0   },     // Green
  { dbz: 35, r: 0,   g: 144, b: 0   },     // Dark Green
  { dbz: 40, r: 255, g: 255, b: 0   },     // Yellow
  { dbz: 45, r: 231, g: 192, b: 0   },     // Golden / Amber
  { dbz: 50, r: 255, g: 144, b: 0   },     // Orange
  { dbz: 55, r: 255, g: 0,   b: 0   },     // Red
  { dbz: 60, r: 214, g: 0,   b: 0   },     // Dark Red
  { dbz: 65, r: 192, g: 0,   b: 0   },     // Crimson
  { dbz: 70, r: 255, g: 0,   b: 255 }      // Extreme / Hail (Magenta)
];

/** Sample pixel color from active RainViewer radar tile covering latlng */
function getRadarPixelData(latlng) {
  if (currentFrameIndex < 0 || !radarFrames[currentFrameIndex]) return null;
  const activeLayer = getActiveRadarLayer();
  if (!activeLayer || !activeLayer._tiles) return null;

  // Screen coordinates of click position relative to map container
  const containerPoint = map.latLngToContainerPoint(latlng);
  const mapRect = map.getContainer().getBoundingClientRect();
  const clickScreenX = mapRect.left + containerPoint.x;
  const clickScreenY = mapRect.top + containerPoint.y;

  for (const key in activeLayer._tiles) {
    const tile = activeLayer._tiles[key];
    if (!tile.el || !tile.el.complete || !tile.el.naturalWidth) continue;

    const tileRect = tile.el.getBoundingClientRect();
    if (
      clickScreenX >= tileRect.left &&
      clickScreenX < tileRect.right &&
      clickScreenY >= tileRect.top &&
      clickScreenY < tileRect.bottom
    ) {
      const offsetX = clickScreenX - tileRect.left;
      const offsetY = clickScreenY - tileRect.top;

      const scaleX = tile.el.naturalWidth / tileRect.width;
      const scaleY = tile.el.naturalHeight / tileRect.height;
      const centerX = Math.min(tile.el.naturalWidth - 1, Math.max(0, Math.floor(offsetX * scaleX)));
      const centerY = Math.min(tile.el.naturalHeight - 1, Math.max(0, Math.floor(offsetY * scaleY)));

      try {
        // Sample a small 5x5 aperture to overcome single-pixel anti-aliasing edges
        const radius = 2;
        const startX = Math.max(0, centerX - radius);
        const startY = Math.max(0, centerY - radius);
        const w = Math.min(tile.el.naturalWidth - startX, 5);
        const h = Math.min(tile.el.naturalHeight - startY, 5);

        const probeCanvas = document.createElement('canvas');
        probeCanvas.width = w;
        probeCanvas.height = h;
        const pCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
        pCtx.drawImage(tile.el, startX, startY, w, h, 0, 0, w, h);
        const imgData = pCtx.getImageData(0, 0, w, h).data;

        // Pinpoint precision: prioritize exact center clicked pixel if opacity >= 50
        const relCenterX = centerX - startX;
        const relCenterY = centerY - startY;
        const centerIdx = (relCenterY * w + relCenterX) * 4;
        let bestR = imgData[centerIdx] || 0;
        let bestG = imgData[centerIdx + 1] || 0;
        let bestB = imgData[centerIdx + 2] || 0;
        let bestA = imgData[centerIdx + 3] || 0;

        // If clicking near a transparent or anti-aliased cloud boundary, search the 5x5 aperture
        if (bestA < 50) {
          for (let i = 0; i < imgData.length; i += 4) {
            const a = imgData[i + 3];
            if (a > bestA) {
              bestA = a;
              bestR = imgData[i];
              bestG = imgData[i + 1];
              bestB = imgData[i + 2];
            }
          }
        }

        return { r: bestR, g: bestG, b: bestB, a: bestA };
      } catch (err) {
        console.warn('Radar pixel sampling fallback:', err);
        return null;
      }
    }
  }
  return null;
}

/**
 * Marshall-Palmer relation: Z = 200 * (R ^ 1.6) -> R = (10 ^ (dBZ / 10) / 200) ^ (1 / 1.6)
 * Calculates rain rate R (mm/h) from radar reflectivity factor Z (dBZ).
 */
function dbzToRainRate(dbz) {
  if (dbz < 10) return 0.0;
  const z = Math.pow(10, dbz / 10);
  const r = Math.pow(z / 200, 1 / 1.6);
  return Math.round(r * 10) / 10;
}

/**
 * Continuous Fine-Graduated Color-to-dBZ matching via 3D Vector Segment Projection.
 * Projects un-multiplied pixel RGB onto the continuous piecewise radar polyline,
 * providing smooth, sub-dBZ continuous interpolation (0.1 dBZ resolution).
 */
function sampleDbzFromPixel(r, g, b, a) {
  if (a < 15) return 0; // Clear sky (transparent)

  // Un-multiply alpha to neutralize canvas/tile anti-aliasing color dimming
  let normR = r;
  let normG = g;
  let normB = b;
  if (a > 15 && a < 255) {
    const factor = 255 / a;
    normR = Math.min(255, Math.round(r * factor));
    normG = Math.min(255, Math.round(g * factor));
    normB = Math.min(255, Math.round(b * factor));
  }

  let minDistanceSq = Infinity;
  let bestDbz = 10;

  // Evaluate orthogonal projection along every segment in the 3D RGB color polyline
  for (let i = 0; i < radarPalette.length - 1; i++) {
    const p1 = radarPalette[i];
    const p2 = radarPalette[i + 1];

    const vr = p2.r - p1.r;
    const vg = p2.g - p1.g;
    const vb = p2.b - p1.b;
    const lenSq = vr * vr + vg * vg + vb * vb;

    if (lenSq === 0) continue;

    const ur = normR - p1.r;
    const ug = normG - p1.g;
    const ub = normB - p1.b;

    // Vector projection factor t clamped to [0, 1]
    const dot = ur * vr + ug * vg + ub * vb;
    const t = Math.max(0, Math.min(1, dot / lenSq));

    // Closest point on the 3D segment in RGB space
    const qr = p1.r + t * vr;
    const qg = p1.g + t * vg;
    const qb = p1.b + t * vb;

    const dr = normR - qr;
    const dg = normG - qg;
    const db = normB - qb;
    const distSq = dr * dr + dg * dg + db * db;

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      bestDbz = p1.dbz + t * (p2.dbz - p1.dbz);
    }
  }

  // Smooth continuous dBZ with 0.1 precision
  return Math.round(bestDbz * 10) / 10;
}

/** Classify rain intensity in Thai based on mm/h rate */
function classifyRainRate(mmph) {
  if (mmph < 0.05) return { text: 'ไม่มีฝน / อากาศแจ่มใส',               cls: 'inspector-category-none' };
  if (mmph < 2.5)  return { text: '🌦️ ฝนปรอย (Light Rain)',             cls: 'inspector-category-light' };
  if (mmph < 10.0) return { text: '🌧️ ฝนปานกลาง (Moderate Rain)',        cls: 'inspector-category-moderate' };
  if (mmph < 50.0) return { text: '⛈️ ฝนตกหนัก (Heavy Rain)',           cls: 'inspector-category-heavy' };
  return              { text: '🌪️ ฝนตกหนักมาก / รุนแรง (Violent Rain)',  cls: 'inspector-category-violent' };
}

async function openRainInspector(e) {
  // Check if Custom Pin mode is active
  if (isCustomPinMode) {
    const newLat = Math.round(e.latlng.lat * 10000) / 10000;
    const newLon = Math.round(e.latlng.lng * 10000) / 10000;
    setTargetLocation([newLat, newLon], `พิกัดกำหนดเอง [${newLat.toFixed(3)}, ${newLon.toFixed(3)}]`);
    toggleCustomPinMode();
    showToast('🎯 ปักหมุดพิกัดสำเร็จ', `ศูนย์กลางใหม่: [${newLat.toFixed(4)}, ${newLon.toFixed(4)}]`);
    return;
  }

  const latlng = e.latlng;
  const lat = latlng.lat.toFixed(5);
  const lon = latlng.lng.toFixed(5);

  // 1. Place or reposition tactical reticle target pin at exact clicked point
  if (!inspectorReticleMarker) {
    inspectorReticleMarker = L.marker(latlng, { icon: targetPinIcon, interactive: false }).addTo(map);
  } else {
    inspectorReticleMarker.setLatLng(latlng);
  }

  // Close previous inspector popup if open
  if (rainInspectorPopup) {
    map.closePopup(rainInspectorPopup);
  }

  // 2. Open sleek tactical Leaflet popup with tip pointer pointing to coordinate
  rainInspectorPopup = L.popup({
    className: 'rain-inspector-popup',
    closeButton: true,
    autoClose: true,
    closeOnClick: false,
    offset: [0, -8],
    maxWidth: 290
  })
    .setLatLng(latlng)
    .setContent(`
      <div class="inspector-card">
        <div class="inspector-header"><i class="fa-solid fa-crosshairs"></i> TACTICAL RAIN INSPECTOR</div>
        <div class="inspector-row">
          <span class="inspector-label">กำลังอ่านค่าเรดาร์...</span>
        </div>
      </div>
    `)
    .openOn(map);

  // Remove reticle target pin when popup is closed
  rainInspectorPopup.on('remove', () => {
    if (inspectorReticleMarker) {
      map.removeLayer(inspectorReticleMarker);
      inspectorReticleMarker = null;
    }
  });

  // 3. Read pixel data from active RainViewer radar tile
  const pixel = getRadarPixelData(latlng);
  let dbz = 0;
  let mmph = 0;

  if (pixel && pixel.a >= 15) {
    // Rain cell echo detected on radar tile!
    dbz = sampleDbzFromPixel(pixel.r, pixel.g, pixel.b, pixel.a);
    mmph = dbzToRainRate(dbz);
  } else if (pixel && pixel.a < 15) {
    // Transparent tile = clear sky
    dbz = 0;
    mmph = 0.0;
  } else {
    // Fallback: Query Open-Meteo precipitation if canvas sampling is unavailable
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latlng.lat}&longitude=${latlng.lng}&current=precipitation&hourly=precipitation&timezone=Asia%2FBangkok&forecast_hours=1`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.current && typeof data.current.precipitation === 'number') {
        mmph = data.current.precipitation;
      } else if (data.hourly && Array.isArray(data.hourly.precipitation) && data.hourly.precipitation.length > 0) {
        mmph = parseFloat(data.hourly.precipitation[0]) || 0;
      }
      dbz = mmph > 0.05 ? Math.round(10 * Math.log10(200 * Math.pow(mmph, 1.6)) * 10) / 10 : 0;
    } catch (err) {
      console.warn('Open-Meteo fallback failed:', err);
    }
  }

  const { text: catText, cls: catCls } = classifyRainRate(mmph);
  const dbzDisplay = dbz >= 10 ? `${dbz.toFixed(1)} dBZ` : '< 10 dBZ (ไม่มีฝน)';
  const rainRateDisplay = mmph > 0 ? `${mmph.toFixed(1)} mm/h` : '0.0 mm/h';

  // Micro color chip indicator for sampled radar echo
  const colorDotHtml = (pixel && pixel.a >= 15 && dbz >= 10)
    ? `<span class="inspector-color-dot" style="background: rgb(${pixel.r}, ${pixel.g}, ${pixel.b});" title="RGB(${pixel.r}, ${pixel.g}, ${pixel.b})"></span>`
    : '';

  const content = `
    <div class="inspector-card">
      <div class="inspector-header"><i class="fa-solid fa-crosshairs"></i> TACTICAL RAIN INSPECTOR</div>
      <div class="inspector-row">
        <span class="inspector-label">📍 พิกัด (Lat):</span>
        <span class="inspector-value">${lat}°N</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">📍 พิกัด (Lon):</span>
        <span class="inspector-value">${lon}°E</span>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">📡 Reflectivity:</span>
        <span class="inspector-value">${colorDotHtml}${dbzDisplay}</span>
      </div>
      <span class="inspector-rain-rate">🌧️ ปริมาณฝน: ${rainRateDisplay}</span>
      <span class="inspector-category-badge ${catCls}">${catText}</span>
    </div>
  `;

  if (rainInspectorPopup && map.hasLayer(rainInspectorPopup)) {
    rainInspectorPopup.setContent(content);
  }
}

if (map) {
  map.on('click', openRainInspector);
  map.on('moveend', () => scheduleStormTrackerAnalysis(currentFrameIndex));
}

// --- 15. EVENT LISTENERS SETUP ---
// Desktop Playback Controls
if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlay);
if (prevBtn) prevBtn.addEventListener('click', () => { if (isPlaying) togglePlay(); stepBackward(); });
if (nextBtn) nextBtn.addEventListener('click', () => { if (isPlaying) togglePlay(); stepForward(); });
if (firstFrameBtn) firstFrameBtn.addEventListener('click', () => { if (isPlaying) togglePlay(); showFrame(0, true); });
if (lastFrameBtn) lastFrameBtn.addEventListener('click', () => {
  if (isPlaying) togglePlay();
  const targetIdx = currentLiveFrameIndex >= 0 ? currentLiveFrameIndex : (radarFrames.length - 1);
  showFrame(targetIdx, true);
});
if (speedBtn) speedBtn.addEventListener('click', cycleSpeed);

// Jump to Live Button (Live T0)
function jumpToLiveFrame() {
  if (isPlaying) togglePlay();
  const targetIdx = currentLiveFrameIndex >= 0 ? currentLiveFrameIndex : 0;
  if (timelineSlider) timelineSlider.value = targetIdx;
  if (mobileTimelineSlider) mobileTimelineSlider.value = targetIdx;
  showFrame(targetIdx, true);
  showToast('📡 ไปยังภาพสดปัจจุบัน', 'แสดงเรดาร์สด Live T0 ล่าสุดเรียบร้อยแล้ว');
}

if (jumpToLiveBtn) jumpToLiveBtn.addEventListener('click', jumpToLiveFrame);

if (loopBtn) {
  loopBtn.addEventListener('click', () => {
    isLooping = !isLooping;
    loopBtn.classList.toggle('active', isLooping);
    loopBtn.title = isLooping ? 'เล่นวนซ้ำ (Loop Playback: เปิด)' : 'เล่นรอบเดียว (Loop Playback: ปิด)';
    showToast(isLooping ? '🔁 เปิดเล่นวนซ้ำ' : '⏹️ ปิดเล่นวนซ้ำ', isLooping ? 'เรดาร์จะวนซ้ำเมื่อถึงเฟรมสุดท้าย' : 'หยุดเมื่อถึงเฟรมสุดท้าย');
  });
}

// Mobile Playback Controls
if (mobilePlayPauseBtn) mobilePlayPauseBtn.addEventListener('click', togglePlay);
if (mobileLiveBtn) mobileLiveBtn.addEventListener('click', jumpToLiveFrame);

// Timeline scrubbing synchronization (Instant feedback)
if (timelineSlider) {
  timelineSlider.addEventListener('input', (e) => {
    if (isPlaying) togglePlay();
    showFrame(parseInt(e.target.value, 10), true);
  });
}
if (mobileTimelineSlider) {
  mobileTimelineSlider.addEventListener('input', (e) => {
    if (isPlaying) togglePlay();
    showFrame(parseInt(e.target.value, 10), true);
  });
}

// Opacity Sliders synchronization
function updateOpacity(val) {
  radarOpacity = parseFloat(val);
  const percentText = `${Math.round(radarOpacity * 100)}%`;
  if (opacitySlider) opacitySlider.value = radarOpacity;
  if (mobileOpacitySlider) mobileOpacitySlider.value = radarOpacity;
  if (opacityVal) opacityVal.textContent = percentText;
  if (mobileOpacityVal) mobileOpacityVal.textContent = percentText;

  const activeLayer = getActiveRadarLayer();
  if (activeLayer) {
    setLayerOpacity(activeLayer, radarOpacity, true);
  }
}

if (opacitySlider) opacitySlider.addEventListener('input', (e) => updateOpacity(e.target.value));
if (mobileOpacitySlider) mobileOpacitySlider.addEventListener('input', (e) => updateOpacity(e.target.value));

// Geolocation & Station Pinning Controls
if (locateBtn) locateBtn.addEventListener('click', locateUser);
if (mobileLocateBtn) mobileLocateBtn.addEventListener('click', locateUser);
if (customPinBtn) customPinBtn.addEventListener('click', toggleCustomPinMode);
if (mobileCustomPinBtn) mobileCustomPinBtn.addEventListener('click', () => {
  closeMobileDrawer();
  toggleCustomPinMode();
});
if (setHomeBtn) setHomeBtn.addEventListener('click', saveCurrentLocationAsHome);
if (mobileSetHomeBtn) mobileSetHomeBtn.addEventListener('click', saveCurrentLocationAsHome);
if (resetLocationBtn) resetLocationBtn.addEventListener('click', resetLocation);
if (mobileResetStationBtn) mobileResetStationBtn.addEventListener('click', resetLocation);

// 7-Day Outlook Modal Open/Close Controls
if (open7DayModalBtn) open7DayModalBtn.addEventListener('click', open7DayModal);
if (mobileOpen7DayModalBtn) mobileOpen7DayModalBtn.addEventListener('click', () => {
  closeMobileDrawer();
  open7DayModal();
});
if (close7DayModalBtn) close7DayModalBtn.addEventListener('click', close7DayModal);
if (sevenDayModalBackdrop) {
  sevenDayModalBackdrop.addEventListener('click', (e) => {
    if (e.target === sevenDayModalBackdrop) close7DayModal();
  });
}

// Global Keyboard Shortcuts (Escape to close any active modal or pin mode)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (gtConfirmBackdrop && gtConfirmBackdrop.classList.contains('is-open')) {
      if (!isSubmittingGroundTruth) {
        cancelGroundTruthReport();
      }
      return;
    }
    closeFeedbackModal();
    close7DayModal();
    if (isCustomPinMode) toggleCustomPinMode();
  }
});

// Ground-Truth Modal Open/Close
if (openFeedbackModalBtn) openFeedbackModalBtn.addEventListener('click', openFeedbackModal);
if (mobileOpenFeedbackBtn) mobileOpenFeedbackBtn.addEventListener('click', () => openMobileDrawer('feedback'));
if (closeModalBtn) closeModalBtn.addEventListener('click', closeFeedbackModal);
if (feedbackModalBackdrop) {
  feedbackModalBackdrop.addEventListener('click', (e) => {
    if (e.target === feedbackModalBackdrop) closeFeedbackModal();
  });
}

// Intercept Desktop Modal Ground-Truth Decisions with 2-Step Verification
if (feedbackEarlyBtn) feedbackEarlyBtn.addEventListener('click', () => initiateGroundTruthReport('early'));
if (feedbackDelayedBtn) feedbackDelayedBtn.addEventListener('click', () => initiateGroundTruthReport('delayed'));
if (feedbackFalseAlarmBtn) feedbackFalseAlarmBtn.addEventListener('click', () => initiateGroundTruthReport('false_alarm'));

// Intercept Mobile Drawer Ground-Truth Decisions with 2-Step Verification
if (drawerFeedbackEarlyBtn) drawerFeedbackEarlyBtn.addEventListener('click', () => initiateGroundTruthReport('early'));
if (drawerFeedbackDelayedBtn) drawerFeedbackDelayedBtn.addEventListener('click', () => initiateGroundTruthReport('delayed'));
if (drawerFeedbackFalseAlarmBtn) drawerFeedbackFalseAlarmBtn.addEventListener('click', () => initiateGroundTruthReport('false_alarm'));

// Ground-Truth 2-Step Confirmation Modal Action Listeners
if (gtCancelBtn) gtCancelBtn.addEventListener('click', cancelGroundTruthReport);
if (gtConfirmBtn) gtConfirmBtn.addEventListener('click', executeGroundTruthReport);
if (gtResultCloseBtn) gtResultCloseBtn.addEventListener('click', cancelGroundTruthReport);
if (gtConfirmBackdrop) {
  gtConfirmBackdrop.addEventListener('click', (e) => {
    if (e.target === gtConfirmBackdrop && !isSubmittingGroundTruth) {
      cancelGroundTruthReport();
    }
  });
}

// Auto-refresh weather every 10 minutes
setInterval(() => {
  fetchOpenMeteoWeather(currentCoords[0], currentCoords[1]);
}, 10 * 60 * 1000);

// --- 16. APPLICATION BOOTSTRAP ---
// Synchronize coordinate and station labels if loaded from localStorage
if (savedHomeStr) {
  const latVal = currentCoords[0].toFixed(4);
  const lonVal = currentCoords[1].toFixed(4);
  const latStr = `${latVal}° N, ${lonVal}° E`;
  if (stationNameDisplay) stationNameDisplay.textContent = currentStationName;
  if (coordsDisplay) coordsDisplay.textContent = latStr;
  if (coordsDisplayLat) coordsDisplayLat.textContent = `${latVal}° N,`;
  if (coordsDisplayLon) coordsDisplayLon.textContent = `${lonVal}° E`;
  if (mobileStationSub) mobileStationSub.textContent = currentStationName;
  if (mobileStationNameDisplay) mobileStationNameDisplay.textContent = currentStationName;
  if (mobileCoordsDisplay) mobileCoordsDisplay.textContent = latStr;
}

// Bootstrap Map, Radar Frames and Open-Meteo Weather once Leaflet (L) is ready
ensureLeafletLoaded(() => {
  initLeafletMap();
  fetchRadarData();
  fetchOpenMeteoWeather(currentCoords[0], currentCoords[1]);
});
