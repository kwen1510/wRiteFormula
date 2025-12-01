const defaultScoringRules = {
  // Points system
  firstTimePoints: 100,
  repeatPoints: 50,

  // Streak multiplier
  minMultiplier: 1.0,
  maxMultiplier: 3.0,
  multiplierIncrement: 0.25,

  // Game settings
  maxAttempts: 2,
  countdownSeconds: 9999,
  warningThreshold: 20
};

let scoringRules = { ...defaultScoringRules };

const STORAGE_LEVEL_KEY = "wfCurrentLevel";

const state = {
  // Data sources
  ions: new Map(), // Ion symbol -> {symbol, name, formula, charge, type}
  speciesHtml: new Map(), // Ion symbol -> HTML formatted version (e.g., "NH4+" -> "NH<sub>4</sub><sup>+</sup>")
  speciesList: [],
  speciesByPrimary: new Map(),
  compoundPairings: new Map(),
  levels: [],

  // Current game state
  currentLevel: 1,
  currentLevel: 1,
  score: 0,
  attempts: 0,
  round: 1,

  // NEW: Level Progress Tracking
  levelProgress: new Map(),
  sessionCompletedCompounds: new Set(),

  // NEW: Streak & Multiplier
  streakMultiplier: 1.0,
  streakCount: 0,
  bestStreak: 0,

  // NEW: Focus Compounds
  currentLevelFocusCompounds: [],
  masteredFocusCompounds: new Set(),
  currentLevelRequirements: [],

  // NEW: Level Species Tracking
  levelSpecies: {}, // All compounds per level
  currentLevelSolvedCompounds: new Set(), // Compounds solved in current level

  // NEW: Board State
  boardFillTarget: 16,
  boardGeneration: 0,

  // UI
  debugPanelVisible: true,
  config: {
    debugPanelVisible: true,
    startAnimation: true,
    scoringRules: { ...defaultScoringRules }
  },

  // Selection state
  selectedIons: [],
  selectedCounts: new Map(),
  selectionCounter: 0,
  buttonRegistry: new Map(),
  selectedButtonIds: new Set(),
  buttonIdCounter: 0,
  completedButtonIds: new Set(),

  // Board state
  activeChallenge: null,
  availableIonsPool: [],
  ionsOnBoard: new Set(),

  // Timer state
  timerId: null,
  timeLeft: scoringRules.countdownSeconds,
  timeExpired: false,
  sessionActive: false,

  // Mode flags
  fastMode: false,

  // Challenge state
  remediationSelection: { formula: null, name: null },
  challengeProgress: null,
  challengeStatus: null,
  removedIonsChargeInfo: { totalCharge: 0, ions: [] }
};

const elements = {
  boardGrid: document.getElementById("board-grid"),
  selectionTray: document.getElementById("selection-tray"),
  submitButton: document.getElementById("submit-selection"),
  timerDisplay: document.getElementById("timer-display"),
  timerBar: document.getElementById("timer-bar"),
  scoreDisplay: document.getElementById("score-display"),
  streakDisplay: document.getElementById("streak-display"),
  roundIndicator: document.getElementById("round-indicator"),
  particleCanvas: document.getElementById("particle-canvas"),
  modal: document.getElementById("remediation-modal"),
  formulaOptions: document.getElementById("formula-options"),
  nameOptions: document.getElementById("name-options"),
  formulaTries: document.getElementById("formula-tries"),
  nameTries: document.getElementById("name-tries"),
  remediationTitle: document.getElementById("remediation-title"),
  remediationSubtitle: document.getElementById("remediation-subtitle"),
  remediationFeedback: document.getElementById("remediation-feedback"),
  acknowledgeButton: document.getElementById("acknowledge-answer"),
  closeModalButton: document.getElementById("close-modal"),
  startModal: document.getElementById("start-modal"),
  startButton: document.getElementById("start-session-button"),
  endModal: document.getElementById("end-modal"),
  playAgainButton: document.getElementById("play-again-button"),
  changeLevelButton: document.getElementById("change-level-button"),
  finalScore: document.getElementById("final-score"),
  finalStreak: document.getElementById("final-streak"),
  finalRounds: document.getElementById("final-rounds"),
  errorModal: document.getElementById("error-modal"),
  errorMessage: document.getElementById("error-message"),
  errorModalClose: document.getElementById("error-modal-close"),
  debugPanel: document.getElementById("debug-panel"),
  debugToggle: document.getElementById("debug-toggle"),
  startAnimation: document.getElementById("start-animation"),
  startAnimationText: document.getElementById("start-animation-text")
};

function getSafeMultiplier(rawValue) {
  if (typeof rawValue === "number" && !Number.isNaN(rawValue)) {
    return rawValue;
  }
  // Fallback to scoringRules or hardcoded default
  return scoringRules?.minMultiplier ?? defaultScoringRules.minMultiplier;
}

function getMaxAttempts() {
  return Number.isFinite(scoringRules?.maxAttempts)
    ? scoringRules.maxAttempts
    : 2;
}

function normalizeOptionKey(value) {
  return (value ?? "").trim().toLowerCase();
}

function getFeedbackEntry(feedbackMap, optionValue) {
  if (!feedbackMap) return null;
  const direct = feedbackMap[optionValue];
  if (direct) return direct;

  const normalizedTarget = normalizeOptionKey(optionValue);
  const fallbackKey = Object.keys(feedbackMap).find(
    (key) => normalizeOptionKey(key) === normalizedTarget
  );
  return fallbackKey ? feedbackMap[fallbackKey] : null;
}

// Ion balancing helper functions
function getIonCharge(species) {
  if (!species || !species.primarySymbol) return 0;

  const match = species.primarySymbol.match(/([+-])$/);
  if (!match) return 0;

  const chargeMatch = species.primarySymbol.match(/(\d+)([+-])$/);
  if (chargeMatch) {
    const magnitude = parseInt(chargeMatch[1], 10);
    return chargeMatch[2] === '+' ? magnitude : -magnitude;
  }

  return match[1] === '+' ? 1 : -1;
}

function getRecommendedCopies(charge) {
  const absCharge = Math.abs(charge);
  if (absCharge === 1) return 3; // ±1 ions need multiple copies
  if (absCharge === 2) return 2; // ±2 ions need some copies
  return 1; // ±3 ions need at least one
}

function hasCompatiblePartner(targetIon, availableIons) {
  const targetCharge = getIonCharge(targetIon);
  if (targetCharge === 0) return false;

  for (const ion of availableIons) {
    const charge = getIonCharge(ion);

    // Opposite charges can potentially balance
    if ((targetCharge > 0 && charge < 0) || (targetCharge < 0 && charge > 0)) {
      return true;
    }
  }

  return false;
}

function groupIonsByCharge(ions) {
  const groups = {
    plus1: [],
    plus2: [],
    plus3: [],
    minus1: [],
    minus2: [],
    minus3: []
  };

  ions.forEach(ion => {
    const charge = getIonCharge(ion);
    if (charge === 1) groups.plus1.push(ion);
    else if (charge === 2) groups.plus2.push(ion);
    else if (charge === 3) groups.plus3.push(ion);
    else if (charge === -1) groups.minus1.push(ion);
    else if (charge === -2) groups.minus2.push(ion);
    else if (charge === -3) groups.minus3.push(ion);
  });

  return groups;
}

function ensureBalanceableSelection(cations, anions, targetCount) {
  const cationGroups = groupIonsByCharge(cations);
  const anionGroups = groupIonsByCharge(anions);

  const tokens = [];

  // Strategy: Add variety of ions with enough copies to ensure solvability

  // 1. Add ALL ±1 ions (most flexible) - 2 copies each
  cationGroups.plus1.forEach(ion => {
    tokens.push(ion);
    tokens.push(ion);
  });

  anionGroups.minus1.forEach(ion => {
    tokens.push(ion);
    tokens.push(ion);
  });

  // 2. Add ±2 ions - 2 copies each
  cationGroups.plus2.forEach(ion => {
    tokens.push(ion);
    tokens.push(ion);
  });

  anionGroups.minus2.forEach(ion => {
    tokens.push(ion);
    tokens.push(ion);
  });

  // 3. Add ±3 ions - 1 copy each (only if we have balancing partners)
  if (cationGroups.plus3.length > 0) {
    // Add if we have -3 anion OR 3+ different -1 anions
    if (anionGroups.minus3.length > 0 || anionGroups.minus1.length >= 3) {
      tokens.push(cationGroups.plus3[0]);
    }
  }

  if (anionGroups.minus3.length > 0) {
    // Add if we have +3 cation OR 3+ different +1 cations
    if (cationGroups.plus3.length > 0 || cationGroups.plus1.length >= 3) {
      tokens.push(anionGroups.minus3[0]);
    }
  }

  return tokens.slice(0, targetCount);
}

// Particle system
const particleSystem = {
  canvas: null,
  ctx: null,
  particles: [],

  init() {
    this.canvas = elements.particleCanvas;
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });

    this.animate();
  },

  createConfetti(x, y, count = 12) {
    const colors = ['#fbbf24', '#f59e0b', '#84cc16'];

    for (let i = 0; i < count; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: Math.random() * -12 - 3,
        gravity: 0.6,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 2,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 8,
        life: 1,
        decay: 0.015
      });
    }
  },

  createExplosion(x, y, count = 8) {
    const colors = ['#fbbf24', '#84cc16'];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = Math.random() * 4 + 2;

      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 4 + 2,
        rotation: 0,
        rotationSpeed: 0,
        life: 1,
        decay: 0.025
      });
    }
  },

  animate() {
    if (!this.ctx) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      p.life -= p.decay;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.globalAlpha = p.life;
      this.ctx.fillStyle = p.color;
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rotation * Math.PI / 180);
      this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      this.ctx.restore();
    }

    requestAnimationFrame(() => this.animate());
  }
};

async function loadIons() {
  try {
    const response = await fetch("./data/ions.json");
    if (!response.ok) {
      throw new Error(`Failed to load ions: HTTP ${response.status}`);
    }
    const ionsData = await response.json();

    // Convert to Map for fast lookup and seed HTML from ions.json
    state.ions.clear();
    state.speciesHtml = state.speciesHtml || new Map();
    for (const [symbol, ionInfo] of Object.entries(ionsData)) {
      state.ions.set(symbol, ionInfo);
      if (!state.speciesHtml.has(symbol)) {
        const htmlFromJson = ionInfo.html;
        state.speciesHtml.set(symbol, htmlFromJson ?? symbol);
      }
    }

    console.log(`✅ Loaded ${state.ions.size} ions with explicit charges`);
  } catch (error) {
    console.error("Failed to load ions:", error);
    throw error;
  }
}

async function loadSpeciesHtml() {
  try {
    const response = await fetch("./data/species_html.json");
    if (!response.ok) {
      throw new Error(`Failed to load species HTML: HTTP ${response.status}`);
    }
    const htmlData = await response.json();

    // Merge into Map for fast lookup (ions.json seed remains as fallback)
    state.speciesHtml = state.speciesHtml || new Map();
    Object.entries(htmlData).forEach(([symbol, html]) => {
      const existing = state.speciesHtml.get(symbol);
      const existingHasMarkup = typeof existing === "string" && (existing.includes("<sub") || existing.includes("<sup"));

      // Preserve richer markup from ions.json; only override when we had no markup
      if (!existingHasMarkup && html !== undefined) {
        state.speciesHtml.set(symbol, html);
      }
    });

    console.log(`✅ Loaded ${state.speciesHtml.size} species HTML formats`);
  } catch (error) {
    console.warn("Failed to load species HTML, will fall back to computed formatting:", error);
  }
}

function getUrlParameter(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

function getInitialLevel() {
  // Check URL parameter first
  const levelParam = getUrlParameter('level');
  if (levelParam) {
    const level = parseInt(levelParam, 10);
    if (!isNaN(level) && level > 0) {
      console.log(`📍 Starting at level ${level} from URL parameter`);
      return level;
    }
  }

  // Default to level 1 (no localStorage - always start fresh)
  console.log(`📍 Starting at level 1 (default)`);
  return 1;
}

async function loadConfig() {
  const defaults = {
    debugPanelVisible: true,
    startAnimation: true,
    scoringRules: { ...defaultScoringRules }
  };

  try {
    const response = await fetch("./data/config.json");
    if (!response.ok) {
      throw new Error(`Failed to load config: HTTP ${response.status}`);
    }
    const config = await response.json();
    state.config = { ...defaults, ...config };
  } catch (error) {
    console.warn("[Config] Falling back to defaults:", error);
    state.config = defaults;
  }

  scoringRules = { ...defaultScoringRules, ...(state.config.scoringRules || {}) };
  state.config.scoringRules = scoringRules;
  state.timeLeft = scoringRules.countdownSeconds;

  state.debugPanelVisible = Boolean(state.config.debugPanelVisible);
  setDebugPanelVisibility(state.debugPanelVisible);
  updateTimerHud();
}

async function init() {
  // Set initial level from URL parameter or localStorage
  state.currentLevel = getInitialLevel();

  // Enable fast mode via URL param (?mode=fast)
  const modeParam = (getUrlParameter('mode') || '').toLowerCase();
  state.fastMode = modeParam === 'fast';
  if (state.fastMode) {
    console.log("[Mode] Fast mode enabled - skipping remediation quizzes.");
  }

  // Initialize new state fields (Phase 8)
  state.levelProgress = new Map();
  state.sessionCompletedCompounds = new Set();
  state.streakMultiplier = scoringRules.minMultiplier;
  state.streakCount = 0;
  state.currentLevelFocusCompounds = [];
  state.masteredFocusCompounds = new Set();
  state.boardFillTarget = 8; // Start with 8 ions (50% of max)
  state.boardGeneration = 0;

  // Load config (e.g., debug panel visibility)
  await loadConfig();

  console.log("Config loaded:", {
    firstTimePoints: scoringRules.firstTimePoints,
    repeatPoints: scoringRules.repeatPoints,
    minMultiplier: scoringRules.minMultiplier,
    maxMultiplier: scoringRules.maxMultiplier,
    multiplierIncrement: scoringRules.multiplierIncrement,
    countdownSeconds: scoringRules.countdownSeconds,
    maxAttempts: scoringRules.maxAttempts,
    warningThreshold: scoringRules.warningThreshold
  });

  console.log("[Init] New progressive system initialized");
  console.log("[Init] Starting board fill: 8/16 (50%)");

  particleSystem.init();

  attachStartModalControls();
  attachEndModalControls();
  attachErrorModalControls();
  attachModalControls();
  attachGlobalControls();
  updateScoreHud();
  updateSelectionTray();

  try {
    await loadIons();
    await loadSpeciesHtml();
    await loadCompoundPairings();
    await loadSpeciesLibrary();
    await loadLevels();

    // Initial debug panel update
    updateDebugPanel();

    openStartModal();
  } catch (error) {
    console.error("Initialisation error:", error);
  }
}

function attachGlobalControls() {
  elements.submitButton?.addEventListener("click", handleSubmitSelection);

  elements.debugToggle?.addEventListener("click", () => {
    const nextState = !state.debugPanelVisible;
    setDebugPanelVisibility(nextState);
  });
}

function attachModalControls() {
  elements.closeModalButton?.addEventListener("click", () => {
    if (state.activeChallenge) {
      // User gave up - break streak
      handleIncorrectAnswer();
      state.challengeStatus = "failed";
    }
    closeModal();
  });

  elements.acknowledgeButton?.addEventListener("click", () => {
    closeModal();
  });
}

function attachStartModalControls() {
  elements.startButton?.addEventListener("click", async () => {
    if (state.sessionActive) {
      return;
    }
    state.sessionActive = true;
    closeStartModal();
    resetTimeBudget();
    await playReadyGoAnimation();
    startTimer();
    console.log(`🎮 Game started! Timer: ${scoringRules.countdownSeconds}s`);
  });
}

function attachEndModalControls() {
  elements.playAgainButton?.addEventListener("click", () => {
    closeEndModal();
    resetGameState();
    openStartModal();
  });
}

function attachErrorModalControls() {
  elements.errorModalClose?.addEventListener("click", () => {
    closeErrorModal();
  });
}

async function loadSpeciesLibrary() {
  // Build species library from compound pairings
  // This extracts all unique cations and anions from the pairings data
  state.speciesList = [];
  state.speciesByPrimary.clear();

  // Extract unique species from compound pairings
  const speciesMap = new Map();

  state.compoundPairings.forEach((pairing) => {
    // Add cation
    if (!speciesMap.has(pairing.cation)) {
      const cationInfo = state.ions.get(pairing.cation);
      if (cationInfo) {
        speciesMap.set(pairing.cation, {
          primarySymbol: pairing.cation,
          type: "cation",
          correctName: pairing.correct.name.split(' ')[0], // e.g., "lithium" from "lithium bromide"
          correctFormula: cationInfo.formula, // e.g., "Ag" not "Ag+"
          chargeMagnitude: cationInfo.charge,
          chargeSign: "+",
          rootFormula: cationInfo.formula
        });
      }
    }

    // Add anion
    if (!speciesMap.has(pairing.anion)) {
      const anionInfo = state.ions.get(pairing.anion);
      if (anionInfo) {
        const nameParts = pairing.correct.name.split(' ');
        const anionName = nameParts[nameParts.length - 1]; // e.g., "bromide" from "lithium bromide"
        speciesMap.set(pairing.anion, {
          primarySymbol: pairing.anion,
          type: "anion",
          correctName: anionName,
          correctFormula: anionInfo.formula, // e.g., "F" not "F-"
          chargeMagnitude: anionInfo.charge,
          chargeSign: "-",
          rootFormula: anionInfo.formula
        });
      }
    }
  });

  // Convert to array and populate state
  speciesMap.forEach((species) => {
    state.speciesList.push(species);
    state.speciesByPrimary.set(species.primarySymbol, species);
  });

  if (state.speciesList.length === 0) {
    throw new Error("No species definitions available.");
  }

  console.log(`Built species library: ${state.speciesList.length} ions (from compound pairings)`);
}

async function loadLevels() {
  const response = await fetch("./data/levels.json");
  if (!response.ok) {
    throw new Error(`Failed to load levels: HTTP ${response.status}`);
  }

  const payload = await response.json();
  console.log('[Data] Raw payload keys:', Object.keys(payload));
  console.log('[Data] GameDifficultyLevels type:', typeof payload.GameDifficultyLevels);
  console.log('[Data] GameDifficultyLevels is array:', Array.isArray(payload.GameDifficultyLevels));

  const levelEntries = Array.isArray(payload.GameDifficultyLevels)
    ? payload.GameDifficultyLevels
    : [];

  console.log('[Data] levelEntries.length before mapping:', levelEntries.length);

  state.levels = levelEntries.map((entry) => ({
    level: Number(entry.Level),
    cations: Array.isArray(entry.Cations) ? entry.Cations : [],
    anions: Array.isArray(entry.Anions) ? entry.Anions : [],
    rationale: entry.Rationale ?? ""
  }));

  console.log(`[Data] Loaded ${state.levels.length} levels from levels.json`);
  console.log(`[Data] Level numbers:`, state.levels.map(l => l.level));

  // Apply the level set from URL parameter or localStorage
  applyLevel(state.currentLevel);
}

async function loadCompoundPairings() {
  try {
    const response = await fetch("./data/compound_pairings_feedback_html.json");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    // Convert array to Map for quick lookup
    state.compoundPairings = new Map();
    data.forEach((pairing) => {
      const key = `${pairing.cation}|${pairing.anion}`;
      state.compoundPairings.set(key, pairing);
    });

    console.log(`[Data] Loaded ${state.compoundPairings.size} compound pairings`);
  } catch (error) {
    console.error("Error loading compound pairings:", error);
    alert("Failed to load game data. Please refresh.");
  }

  // Load level_species.json
  try {
    const response = await fetch("./data/level_species.json");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    state.levelSpecies = await response.json();
    console.log(`[Data] Loaded species for ${Object.keys(state.levelSpecies).length} levels`);
  } catch (error) {
    console.error("Error loading level species:", error);
    alert("Failed to load level species data. Please refresh.");
  }
}

function generateFocusCompounds(levelEntry) {
  const focusCompounds = [];
  const cations = levelEntry.cations.map(sym => state.speciesByPrimary.get(sym)).filter(Boolean);
  const anions = levelEntry.anions.map(sym => state.speciesByPrimary.get(sym)).filter(Boolean);

  // Generate all valid combinations
  for (const cation of cations) {
    for (const anion of anions) {
      const key = `${cation.primarySymbol}|${anion.primarySymbol}`;
      const pairing = state.compoundPairings.get(key);

      if (pairing) {
        focusCompounds.push({
          cation: cation.primarySymbol,
          anion: anion.primarySymbol,
          formula: pairing.correct.formula,
          name: pairing.correct.name,
          key: key
        });
      }
    }
  }

  console.log(`[Focus] Level ${levelEntry.level}: ${focusCompounds.length} focus compounds`);
  return focusCompounds;
}

function buildSolvedSetForLevel(levelNumber) {
  const solved = new Set();
  const levelData = state.levelSpecies?.[levelNumber];
  if (!levelData || !Array.isArray(levelData.compounds)) {
    return solved;
  }

  const solvedKeys = state.sessionCompletedCompounds || new Set();
  levelData.compounds.forEach((compound) => {
    if (solvedKeys.has(compound.key)) {
      solved.add(compound.key);
    }
  });

  return solved;
}

function applyLevel(levelNumber) {
  const entry = state.levels.find((item) => item.level === levelNumber);
  if (!entry) {
    return;
  }

  // Set current level
  state.currentLevel = entry.level;
  saveLevel(entry.level);

  // Generate focus compounds for this level
  state.currentLevelFocusCompounds = generateFocusCompounds(entry);
  state.masteredFocusCompounds.clear();

  // Reset per-level solved tracking using session history
  state.currentLevelSolvedCompounds = buildSolvedSetForLevel(entry.level);

  // Reset board state
  state.boardFillTarget = 8;  // Start with 8 ions
  state.selectedIons = [];
  state.activeChallenge = null;

  // Reset timer
  stopTimer();
  resetTimeBudget();
  if (state.sessionActive) {
    startTimer();
  }

  // Reset selection state
  state.selectedCounts = new Map();
  state.selectionCounter = 0;
  state.buttonRegistry.clear();
  state.selectedButtonIds.clear();
  state.buttonIdCounter = 0;
  state.completedButtonIds = new Set();
  state.attempts = 0;
  state.timeExpired = false;
  state.availableIonsPool = [];
  state.ionsOnBoard = new Set();
  state.removedIonsChargeInfo = { totalCharge: 0, ions: [] };

  updateTimerHud();
  updateSelectionTray();
  updateDebugPanel();

  // Render board
  renderBoard(entry);

  console.log(`[Apply Level] Level ${entry.level} loaded, ${state.currentLevelFocusCompounds.length} focus compounds`);
}

function calculateRequiredBoardSize(compounds) {
  let totalMandatoryIons = 0;

  for (const compound of compounds) {
    const cationInfo = state.ions.get(compound.cation);
    const anionInfo = state.ions.get(compound.anion);

    if (!cationInfo || !anionInfo) {
      console.warn(`[Board Size] Missing ion info for ${compound.cation} or ${compound.anion}`);
      continue;
    }

    const lcm = (cationInfo.charge * anionInfo.charge) / gcd(cationInfo.charge, anionInfo.charge);
    const requiredCations = lcm / cationInfo.charge;
    const requiredAnions = lcm / anionInfo.charge;

    totalMandatoryIons += requiredCations + requiredAnions;
  }

  // Add buffer for distractors (20%)
  const withBuffer = Math.ceil(totalMandatoryIons * 1.2);

  // Cap at 16 max
  return Math.min(withBuffer, 16);
}

function renderBoard(entry) {
  if (!elements.boardGrid) {
    return;
  }

  state.boardGeneration++;
  console.log(`[Board Gen ${state.boardGeneration}] Starting for Level ${entry.level}`);

  // STEP 1: Select priority compounds (unchanged)
  const priorityCompounds = selectPriorityFocusCompounds(3);
  console.log(`[Board Gen ${state.boardGeneration}] Priority compounds:`, priorityCompounds.map(c => c.name));

  // STEP 2: PRE-VALIDATE - Calculate required board size
  const requiredSize = calculateRequiredBoardSize(priorityCompounds);

  // STEP 3: Dynamically set board target to fit compounds
  state.boardFillTarget = requiredSize;
  console.log(`[Board Gen ${state.boardGeneration}] Board size set to ${requiredSize} ions (required for 3 compounds)`);

  // STEP 4: Build mandatory ions (no size filtering needed!)
  const mandatoryTokens = [];
  priorityCompounds.forEach(compound => {
    const cationInfo = state.ions.get(compound.cation);
    const anionInfo = state.ions.get(compound.anion);

    if (!cationInfo || !anionInfo) {
      console.warn(`[Board Gen ${state.boardGeneration}] Missing ion info for compound`);
      return;
    }

    const lcm = (cationInfo.charge * anionInfo.charge) / gcd(cationInfo.charge, anionInfo.charge);
    const requiredCations = lcm / cationInfo.charge;
    const requiredAnions = lcm / anionInfo.charge;

    for (let i = 0; i < requiredCations; i++) {
      mandatoryTokens.push(compound.cation);
    }
    for (let i = 0; i < requiredAnions; i++) {
      mandatoryTokens.push(compound.anion);
    }
  });

  console.log(`[Board Gen ${state.boardGeneration}] Mandatory tokens:`, mandatoryTokens);

  // STEP 5: Fill to target with distractors
  const allLevelIons = [...entry.cations, ...entry.anions];
  const tokens = buildTokenList(mandatoryTokens, allLevelIons, state.boardFillTarget);

  console.log(`[Board Gen ${state.boardGeneration}] Token count: ${tokens.length} (target: ${state.boardFillTarget})`);

  // STEP 6: Final validation (should always pass now)
  if (!validateBoardHasFocusCompounds(tokens, priorityCompounds, 3)) {
    console.error(`[Board Gen ${state.boardGeneration}] UNEXPECTED: Validation failed after pre-sizing!`);
    // This shouldn't happen, but if it does, try once more with max board
    if (state.boardFillTarget < 16) {
      state.boardFillTarget = 16;
      return renderBoard(entry); // Retry with max board
    }
  }

  // Build available pool for this level
  state.availableIonsPool = [];
  entry.cations.forEach((symbol) => {
    const species = state.speciesByPrimary.get(symbol);
    if (species) {
      state.availableIonsPool.push(species);
    }
  });
  entry.anions.forEach((symbol) => {
    const species = state.speciesByPrimary.get(symbol);
    if (species) {
      state.availableIonsPool.push(species);
    }
  });

  // STEP 7: Render to grid
  console.log(`[Board Gen ${state.boardGeneration}] Complete`);
  renderTokensToGrid(tokens);

  // Update focus compounds tracking
  state.currentLevelFocusCompounds = entry.focusCompounds || [];
}

function selectPriorityFocusCompounds(count) {
  if (state.currentLevelFocusCompounds.length === 0) {
    return [];
  }

  // SMART SELECTION: Prioritize compounds that meet unmet requirements
  const unmet = getUnmetLevelRequirements(state.currentLevel);
  let requiredCompounds = [];

  if (unmet.length > 0) {
    // Filter focus compounds to only those that meet an unmet requirement
    requiredCompounds = state.currentLevelFocusCompounds.filter(fc => {
      const [catSym, anSym] = fc.key.split('|');
      const cG = getIonGroup(catSym);
      const aG = getIonGroup(anSym);

      return unmet.some(req => {
        if (req.type === 'match') {
          const catMatch = !req.catGroup || cG === req.catGroup;
          const anMatch = !req.anGroup || aG === req.anGroup;
          return catMatch && anMatch;
        } else if (req.type === 'specific') {
          return catSym === req.symbol || anSym === req.symbol;
        }
        return false;
      });
    });
  }

  // Separate unmastered and mastered compounds
  const unmastered = state.currentLevelFocusCompounds.filter(
    c => !state.masteredFocusCompounds.has(c.key)
  );

  const selected = [];

  // 1. Add required compounds first (shuffled)
  if (requiredCompounds.length > 0) {
    const shuffledRequired = shuffleArray([...requiredCompounds]);
    // Try to pick different ones if possible, but prioritize filling the count
    selected.push(...shuffledRequired.slice(0, count));
  }

  // 2. If we need more, add other unmastered compounds
  if (selected.length < count) {
    // Filter out already selected
    const selectedKeys = new Set(selected.map(c => c.key));
    const remainingUnmastered = unmastered.filter(c => !selectedKeys.has(c.key));

    const shuffledUnmastered = shuffleArray([...remainingUnmastered]);
    selected.push(...shuffledUnmastered.slice(0, count - selected.length));
  }

  // 3. If we still need more, fill with mastered compounds
  if (selected.length < count) {
    const selectedKeys = new Set(selected.map(c => c.key));
    const remainingMastered = state.currentLevelFocusCompounds.filter(
      c => !selectedKeys.has(c.key)
    );
    const shuffledMastered = shuffleArray([...remainingMastered]);
    selected.push(...shuffledMastered.slice(0, count - selected.length));
  }

  return selected;
}

function buildTokenList(mandatoryIons, allLevelIons, targetCount) {
  const tokens = [];

  // Start with mandatory ions (1 copy each)
  mandatoryIons.forEach(ionSymbol => {
    tokens.push(ionSymbol);
  });

  // Add duplicates of mandatory ions for balance
  const duplicatesNeeded = Math.max(0, Math.floor((targetCount - tokens.length) / 2));
  const shuffledMandatory = shuffleArray([...mandatoryIons]);
  for (let i = 0; i < duplicatesNeeded && i < shuffledMandatory.length; i++) {
    tokens.push(shuffledMandatory[i]);
  }

  // Fill remaining slots with random ions from the level
  const remainingSlots = targetCount - tokens.length;
  if (remainingSlots > 0) {
    const otherIons = allLevelIons.filter(ion => !mandatoryIons.includes(ion));
    const shuffledOther = shuffleArray([...otherIons]);

    for (let i = 0; i < remainingSlots && i < shuffledOther.length; i++) {
      tokens.push(shuffledOther[i]);
    }

    // If still not enough, add more duplicates
    while (tokens.length < targetCount && allLevelIons.length > 0) {
      const randomIon = allLevelIons[Math.floor(Math.random() * allLevelIons.length)];
      tokens.push(randomIon);
    }
  }

  return tokens.slice(0, targetCount);
}

function getCurrentBoardTokens() {
  const tokens = [];
  if (!elements.boardGrid) return tokens;

  const wrappers = Array.from(elements.boardGrid.children);
  wrappers.forEach(wrapper => {
    const button = wrapper.querySelector('.ion-button');
    if (button) {
      const primarySymbol = button.dataset.primarySymbol;
      if (primarySymbol) {
        tokens.push(primarySymbol);
      }
    }
  });

  return tokens;
}

function validateBoardHasFocusCompounds(tokens, priorityCompounds, minCount) {
  // Count available ions (not just presence, but actual counts)
  const ionCounts = new Map();

  tokens.forEach(ionSymbol => {
    ionCounts.set(ionSymbol, (ionCounts.get(ionSymbol) || 0) + 1);
  });

  // Count how many priority compounds are actually solvable
  let solvableCount = 0;
  priorityCompounds.forEach(compound => {
    const cationInfo = state.ions.get(compound.cation);
    const anionInfo = state.ions.get(compound.anion);

    if (!cationInfo || !anionInfo) {
      return; // Skip if ion data not found
    }

    // Calculate required counts using LCM of charges
    const cationCharge = cationInfo.charge;
    const anionCharge = anionInfo.charge;
    const lcm = (cationCharge * anionCharge) / gcd(cationCharge, anionCharge);
    const requiredCations = lcm / cationCharge;
    const requiredAnions = lcm / anionCharge;

    // Check if we have enough of each ion
    const availableCations = ionCounts.get(compound.cation) || 0;
    const availableAnions = ionCounts.get(compound.anion) || 0;

    if (availableCations >= requiredCations && availableAnions >= requiredAnions) {
      solvableCount++;
    }
  });

  const result = solvableCount >= minCount;
  if (!result) {
    console.warn(`[Validation] Only ${solvableCount}/${minCount} compounds solvable`);
  }
  return result;
}

function clearAndRegenerateBoard(entry) {
  console.warn('[Board] Clearing and regenerating');

  // Visual feedback for regeneration
  const grid = elements.boardGrid;
  if (grid) {
    grid.classList.add('opacity-50');
    setTimeout(() => grid.classList.remove('opacity-50'), 300);
  }

  state.boardGeneration++;

  // Safety check (should rarely hit this now)
  if (state.boardGeneration > 20) {
    console.error('[Board] Too many regeneration attempts - setting board to max size');
    state.boardFillTarget = 16;
  }

  renderBoard(entry);
}

function renderTokensToGrid(tokens) {
  if (!elements.boardGrid) {
    return;
  }

  elements.boardGrid.innerHTML = "";
  state.buttonRegistry.clear();
  state.selectedButtonIds.clear();
  state.buttonIdCounter = 0;
  state.ionsOnBoard.clear();
  state.completedButtonIds.clear(); // Reset completed buttons for new board

  // Mark ions as on board
  tokens.forEach(ionSymbol => {
    state.ionsOnBoard.add(ionSymbol);
  });

  const MAX_SLOTS = 16;
  const slots = Array(MAX_SLOTS).fill(null).map(() => ({ type: "empty" }));

  // Convert ion symbols to species objects
  const speciesTokens = tokens.map(sym => state.speciesByPrimary.get(sym)).filter(Boolean);

  // Randomly place ions in the grid
  const shuffledTokens = shuffleArray(speciesTokens);
  const availablePositions = shuffleArray([...Array(MAX_SLOTS).keys()]);

  shuffledTokens.forEach((species, index) => {
    if (index < availablePositions.length) {
      slots[availablePositions[index]] = {
        type: "ion",
        species
      };
    }
  });

  // Render slots
  slots.forEach((slot) => {
    const wrapper = document.createElement("div");
    // Use w-full h-full to fill the grid cell, but keep aspect-square to ensure circle shape
    // max-w/max-h ensures it fits within the cell if the cell is rectangular
    wrapper.className = "flex aspect-square items-center justify-center w-full h-full max-w-full max-h-full";

    if (slot.type === "ion") {
      const button = createIonButton(slot.species);
      button.classList.add("ion-button-appear");
      wrapper.appendChild(button);
    } else {
      const hole = document.createElement("div");
      // Use w-[85%] h-[85%] to be slightly smaller than the cell
      hole.className =
        "w-[85%] h-[85%] rounded-full bg-gradient-to-b from-slate-700 to-slate-800 shadow-inner";
      wrapper.appendChild(hole);
    }

    elements.boardGrid.appendChild(wrapper);
  });
}

function createIonButton(species) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.primarySymbol = species.primarySymbol;
  button.dataset.ionType = species.type;
  state.buttonIdCounter += 1;
  const tokenId = `token-${state.buttonIdCounter}`;
  button.dataset.tokenId = tokenId;
  const colorClass =
    species.type === "cation"
      ? "border-amber-600 bg-gradient-to-b from-amber-200 to-amber-300 text-amber-900 shadow-[0_4px_0_0_rgba(180,83,9,0.5)]"
      : "border-slate-400 bg-gradient-to-b from-slate-100 to-slate-200 text-slate-800 shadow-[0_4px_0_0_rgba(71,85,105,0.4)]";
  // box-border keeps the outer diameter identical to holes; padding removed for consistency
  button.className = `ion-button w-[85%] h-[85%] box-border inline-flex items-center justify-center rounded-full border-4 ${colorClass} text-center text-sm font-bold shadow-lg transition hover:-translate-y-1 hover:shadow-xl active:translate-y-0`;

  // Use HTML formatted version if available, otherwise fallback to plain symbol
  const displayHtml = state.speciesHtml.get(species.primarySymbol) || species.primarySymbol;
  button.innerHTML = `
    <span class="block text-lg font-bold leading-none">${displayHtml}</span>
  `;

  state.buttonRegistry.set(tokenId, button);

  if (state.completedButtonIds.has(tokenId) || state.timeExpired) {
    disableIonButton(button);
  } else {
    button.addEventListener("click", () => handleIonSelection(species, button));
  }

  return button;
}

function handleIonSelection(species, button) {
  if (!state.sessionActive) {
    return;
  }
  if (state.timeExpired) {
    return;
  }
  if (state.activeChallenge) {
    return;
  }

  const tokenId = button.dataset.tokenId;
  if (!tokenId) {
    return;
  }
  if (state.completedButtonIds.has(tokenId)) {
    return;
  }

  if (state.selectedButtonIds.has(tokenId)) {
    removeSelectionByButtonId(tokenId);
    return;
  }

  state.selectionCounter += 1;
  state.selectedIons.push({ id: state.selectionCounter, species, buttonId: tokenId });
  state.selectedButtonIds.add(tokenId);
  const nextCount = (state.selectedCounts.get(species.primarySymbol) ?? 0) + 1;
  state.selectedCounts.set(species.primarySymbol, nextCount);
  setButtonSelectionStyles(button, true);
  updateSelectionTray();
}

function handleSubmitSelection() {
  if (!state.sessionActive) {
    return;
  }
  if (state.timeExpired) {
    return;
  }
  if (state.activeChallenge) {
    return;
  }
  if (state.selectedIons.length < 2) {
    return;
  }

  const validationResult = runSelectionValidations(state.selectedIons);
  if (!validationResult.ok) {
    flashInvalidSelection(validationResult.message);
    return;
  }

  const cationEntry = state.selectedIons.find(
    (entry) => entry.species.type === "cation"
  );
  const anionEntry = state.selectedIons.find(
    (entry) => entry.species.type === "anion"
  );

  if (!cationEntry || !anionEntry) {
    logMessage("Select at least one cation and one anion before submitting.", "error");
    return;
  }

  const cation = cationEntry.species;
  const anion = anionEntry.species;

  const challenge = buildChallenge(cation, anion);
  if (!challenge) {
    flashInvalidSelection("That pairing is not available yet. Try another match.");
    return;
  }

  state.activeChallenge = challenge;
  if (state.fastMode) {
    completeChallengeInstantly();
    return;
  }

  startRemediation(challenge);
}

function lookupPairing(cation, anion) {
  const key = `${cation.primarySymbol}|${anion.primarySymbol}`;
  return state.compoundPairings.get(key);
}

function selectRandomMistakes(mistakeArray, count) {
  if (!mistakeArray || mistakeArray.length === 0) {
    return [];
  }

  // If fewer mistakes than requested, use all available
  if (mistakeArray.length <= count) {
    return [...mistakeArray];
  }

  // Randomly select 'count' mistakes
  const shuffled = shuffleArray([...mistakeArray]);
  return shuffled.slice(0, count);
}

/**
 * Convert a chemical formula to HTML with subscripts
 * @param {string} formula - Plain text formula like "PbCl2"
 * @returns {string} HTML formatted formula like "PbCl<sub>2</sub>"
 */
function formulaToHtml(formula) {
  if (!formula) return formula;
  // Replace digits with subscript tags
  return formula.replace(/(\d+)/g, '<sub>$1</sub>');
}

function buildOptionsFromPairing(pairing, correctFormula, correctName) {
  // Build formula options
  const formulaMistakes = pairing.mistakes.formula || [];
  const formulaFeedbackList = pairing.feedback.formula || [];

  const selectedFormulaMistakes = selectRandomMistakes(formulaMistakes, 2);
  const formulaOptionsValues = shuffleArray([correctFormula, ...selectedFormulaMistakes]);

  const formulaFeedback = {};
  formulaFeedbackList.forEach(item => {
    const entry = {
      text: item.feedback,
      html: item.feedback_html,
      optionHtml: item.option_html
    };
    formulaFeedback[item.option] = entry;
    if (item.option_html) {
      formulaFeedback[item.option_html] = entry;
    }
  });

  // Build name options
  const nameMistakes = pairing.mistakes.name || [];
  const nameFeedbackList = pairing.feedback.name || [];

  const selectedNameMistakes = selectRandomMistakes(nameMistakes, 2);
  const nameOptionsValues = shuffleArray([correctName, ...selectedNameMistakes]);

  const nameFeedback = {};
  nameFeedbackList.forEach(item => {
    const entry = {
      text: item.feedback,
      html: item.feedback_html,
      optionHtml: item.option_html
    };
    nameFeedback[item.option] = entry;
    if (item.option_html) {
      nameFeedback[item.option_html] = entry;
    }
  });

  const formulaOptions = formulaOptionsValues.map(value => ({
    value,
    // FIX: Use formulaToHtml for correct answer, otherwise use option_html from feedback
    displayHtml: formulaFeedback[value]?.optionHtml ?? formulaToHtml(value)
  }));

  const nameOptions = nameOptionsValues.map(value => ({
    value,
    displayHtml: nameFeedback[value]?.optionHtml ?? value
  }));

  return {
    formulaOptions,
    nameOptions,
    formulaFeedback,
    nameFeedback
  };
}

function buildChallenge(cation, anion) {
  if (!cation || !anion) {
    return null;
  }

  const correctFormula = computeNeutralFormula(cation, anion);
  if (!correctFormula) {
    return null;
  }

  const correctName = `${cation.correctName} ${anion.correctName}`.trim();

  // Try to use compound_pairings.json data
  const pairing = lookupPairing(cation, anion);

  let formulaOptions, nameOptions, formulaFeedback, nameFeedback;
  let challengeCorrectFormula = correctFormula;
  let challengeCorrectName = correctName;

  if (pairing) {
    // Use curated pairing data
    challengeCorrectFormula = pairing.correct.formula ?? correctFormula;
    challengeCorrectName = pairing.correct.name ?? correctName;

    const result = buildOptionsFromPairing(
      pairing,
      challengeCorrectFormula,
      challengeCorrectName
    );
    formulaOptions = result.formulaOptions;
    nameOptions = result.nameOptions;
    formulaFeedback = result.formulaFeedback;
    nameFeedback = result.nameFeedback;
  } else {
    // Fallback to current system
    formulaOptions = buildFormulaOptions(cation, anion, correctFormula).map(value => ({
      value,
      displayHtml: value
    }));
    nameOptions = buildNameOptions(cation, anion, correctName).map(value => ({
      value,
      displayHtml: value
    }));
    formulaFeedback = {};
    nameFeedback = {};
  }

  if (formulaOptions.length === 0 || nameOptions.length === 0) {
    return null;
  }

  return {
    cation,
    anion,
    prompt: "Identify the correct formula and name.",
    difficulty: `Level ${state.currentLevel}`,
    correctFormula: challengeCorrectFormula,
    correctName: challengeCorrectName,
    formulaOptions,
    nameOptions,
    formulaFeedback,
    nameFeedback
  };
}

function computeNeutralFormula(cation, anion) {
  const cCharge = Math.max(1, cation.chargeMagnitude);
  const aCharge = Math.max(1, anion.chargeMagnitude);
  const lcmValue = lcm(cCharge, aCharge);
  const cCount = lcmValue / cCharge;
  const aCount = lcmValue / aCharge;

  const cPart = formatFormulaSegment(cation.correctFormula, cCount);
  const aPart = formatFormulaSegment(anion.correctFormula, aCount);

  return `${cPart}${aPart}`;
}

function buildFormulaOptions(cation, anion, correctFormula) {
  const cationTags = Object.keys(cation.formulaMistakes);
  const anionTags = Object.keys(anion.formulaMistakes);
  const sharedTags = selectMistakeTags(cationTags, anionTags).slice(0, 3);
  const cationMistakes = orderedMistakeValues(cation, "formula");
  const anionMistakes = orderedMistakeValues(anion, "formula");

  const options = new Set();
  options.add(correctFormula);

  sharedTags.forEach((tag) => {
    const catMistake = cation.formulaMistakes[tag];
    const anMistake = anion.formulaMistakes[tag];
    if (!catMistake || !anMistake) {
      return;
    }
    const assembled = `${catMistake}${anMistake}`;
    if (assembled !== correctFormula) {
      options.add(assembled);
    }
  });

  if (options.size === 1) {
    const catFallback = cation.formulaMistakes["Mistake #1"];
    const anFallback = anion.formulaMistakes["Mistake #1"];
    if (catFallback && anFallback) {
      const fallback = `${catFallback}${anFallback}`;
      if (fallback !== correctFormula) {
        options.add(fallback);
      }
    }
  }

  if (options.size < 3) {
    cationMistakes.forEach((cat) => {
      if (options.size >= 3 || !cat) return;
      options.add(`${cat}${anion.correctFormula}`);
    });
  }

  if (options.size < 3) {
    anionMistakes.forEach((an) => {
      if (options.size >= 3 || !an) return;
      options.add(`${cation.correctFormula}${an}`);
    });
  }

  if (options.size < 3) {
    const limit = Math.min(cationMistakes.length, anionMistakes.length);
    for (let i = 0; i < limit && options.size < 3; i += 1) {
      const cat = cationMistakes[i];
      const an = anionMistakes[i];
      if (cat && an) {
        options.add(`${cat}${an}`);
      }
    }
  }

  while (options.size < 3) {
    options.add(`${cation.correctFormula}${anion.correctFormula}${options.size}`);
  }

  return shuffleArray(Array.from(options).slice(0, 3));
}

function buildNameOptions(cation, anion, correctName) {
  const cationTags = Object.keys(cation.nameMistakes);
  const anionTags = Object.keys(anion.nameMistakes);
  const sharedTags = selectMistakeTags(cationTags, anionTags).slice(0, 3);
  const cationMistakes = orderedMistakeValues(cation, "name");
  const anionMistakes = orderedMistakeValues(anion, "name");

  const options = new Set();
  options.add(correctName);

  sharedTags.forEach((tag) => {
    const catMistake = cation.nameMistakes[tag];
    const anMistake = anion.nameMistakes[tag];
    if (!catMistake || !anMistake) {
      return;
    }
    const assembled = `${catMistake} ${anMistake}`.trim();
    if (assembled && assembled !== correctName) {
      options.add(assembled);
    }
  });

  if (options.size === 1) {
    const catFallback = cation.nameMistakes["Mistake #1"];
    const anFallback = anion.nameMistakes["Mistake #1"];
    if (catFallback && anFallback) {
      const fallback = `${catFallback} ${anFallback}`.trim();
      if (fallback && fallback !== correctName) {
        options.add(fallback);
      }
    }
  }

  if (options.size < 3) {
    cationMistakes.forEach((cat) => {
      if (options.size >= 3 || !cat) return;
      options.add(`${cat} ${anion.correctName}`.trim());
    });
  }

  if (options.size < 3) {
    anionMistakes.forEach((an) => {
      if (options.size >= 3 || !an) return;
      options.add(`${cation.correctName} ${an}`.trim());
    });
  }

  if (options.size < 3) {
    const limit = Math.min(cationMistakes.length, anionMistakes.length);
    for (let i = 0; i < limit && options.size < 3; i += 1) {
      const cat = cationMistakes[i];
      const an = anionMistakes[i];
      if (cat && an) {
        options.add(`${cat} ${an}`.trim());
      }
    }
  }

  while (options.size < 3) {
    options.add(`${cation.correctName} ${anion.correctName} (${options.size})`);
  }

  return shuffleArray(Array.from(options).slice(0, 3));
}

function selectMistakeTags(cationTags, anionTags) {
  const shared = cationTags.filter((tag) => anionTags.includes(tag));
  if (shared.length === 0) {
    return [];
  }

  const priority = [
    "Mistake #1",
    "Mistake #4",
    "Mistake #2",
    "Mistake #5",
    "Mistake #3",
    "Mistake #7"
  ];

  const ordered = [];
  priority.forEach((tag) => {
    if (shared.includes(tag)) {
      ordered.push(tag);
    }
  });

  shared.forEach((tag) => {
    if (!ordered.includes(tag)) {
      ordered.push(tag);
    }
  });

  return ordered;
}

function orderedMistakeValues(species, kind) {
  const source =
    kind === "formula" ? species.formulaMistakes ?? {} : species.nameMistakes ?? {};
  const priority = [
    "Mistake #1",
    "Mistake #4",
    "Mistake #2",
    "Mistake #5",
    "Mistake #3",
    "Mistake #7"
  ];

  const values = [];
  priority.forEach((tag) => {
    const candidate = source[tag];
    if (candidate && !values.includes(candidate)) {
      values.push(candidate);
    }
  });

  Object.values(source).forEach((candidate) => {
    if (candidate && !values.includes(candidate)) {
      values.push(candidate);
    }
  });

  return values;
}

function completeChallengeInstantly() {
  if (!state.activeChallenge) {
    return;
  }

  state.challengeStatus = "active";
  state.challengeProgress = {
    formula: { attempts: 0, solved: true },
    name: { attempts: 0, solved: true }
  };
  state.remediationSelection = { formula: null, name: null };
  state.attempts = 0;

  console.log("[Mode] Fast mode: bypassing remediation quiz for current match.");
  completeChallengeSuccess();
}

function startRemediation(challenge) {
  state.attempts = 0;
  state.remediationSelection = { formula: null, name: null };
  state.challengeProgress = {
    formula: { attempts: 0, solved: false },
    name: { attempts: 0, solved: false }
  };
  state.challengeStatus = "active";
  updateTimerHud();

  populateModal(challenge);
  openModal();
}

function populateModal(challenge) {
  elements.remediationTitle.textContent = challenge.prompt;
  elements.remediationFeedback.textContent =
    "Each column allows two tries. Lock in the right formula and name to continue.";
  elements.acknowledgeButton.classList.add("hidden");

  // Populate selected ions display
  const selectedIonsDisplay = document.getElementById("selected-ions-display");
  if (selectedIonsDisplay && state.selectedIons && state.selectedIons.length > 0) {
    selectedIonsDisplay.innerHTML = "";

    // Group ions by primary symbol and count them
    const ionCounts = new Map();
    state.selectedIons.forEach(entry => {
      const symbol = entry.species.primarySymbol;
      if (!ionCounts.has(symbol)) {
        ionCounts.set(symbol, { species: entry.species, count: 0 });
      }
      ionCounts.get(symbol).count++;
    });

    // Sort: cations first, then anions
    const sortedIons = Array.from(ionCounts.values()).sort((a, b) => {
      if (a.species.type === "cation" && b.species.type === "anion") return -1;
      if (a.species.type === "anion" && b.species.type === "cation") return 1;
      return 0;
    });

    // Create display for each unique ion with count
    sortedIons.forEach(({ species, count }) => {
      const ionDiv = createIonDisplay(species, count);
      selectedIonsDisplay.appendChild(ionDiv);
    });
  }

  renderOptions(elements.formulaOptions, challenge.formulaOptions, "formula");
  renderOptions(elements.nameOptions, challenge.nameOptions, "name");
  updateColumnTries("formula");
  updateColumnTries("name");
}

function createIonDisplay(species, count = 1) {
  const div = document.createElement("div");
  div.className = "relative";

  const colorClass =
    species.type === "cation"
      ? "border-sky-400 bg-gradient-to-b from-sky-200 to-sky-300 text-sky-900"
      : "border-purple-400 bg-gradient-to-b from-purple-200 to-purple-300 text-purple-900";

  const circle = document.createElement("div");
  circle.className = `flex h-16 w-16 items-center justify-center rounded-full border-4 ${colorClass} shadow-lg`;

  const displayHtml = state.speciesHtml.get(species.primarySymbol) || species.primarySymbol;
  circle.innerHTML = `<span class="text-base font-bold">${displayHtml}</span>`;

  div.appendChild(circle);

  // Add count badge if more than 1
  if (count > 1) {
    const badge = document.createElement("div");
    badge.className = "absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-900 bg-amber-100 text-xs font-black text-amber-900 shadow-md";
    badge.textContent = `×${count}`;
    div.appendChild(badge);
  }

  return div;
}

function renderOptions(container, options, type) {
  container.innerHTML = "";
  options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.optionType = type;
    btn.dataset.optionValue = option.value;
    btn.className =
      "option-button w-full rounded-2xl border-4 border-slate-600/50 bg-gradient-to-b from-slate-200 to-slate-300 px-3 py-3 text-center text-sm font-bold text-slate-900 shadow-[0_4px_0_0_rgba(71,85,105,0.4)] transition hover:-translate-y-0.5 hover:shadow-[0_5px_0_0_rgba(71,85,105,0.4)] active:translate-y-0 active:shadow-[0_2px_0_0_rgba(71,85,105,0.4)] sm:px-4 sm:py-3";
    btn.innerHTML = option.displayHtml;
    btn.title = option.value;

    btn.addEventListener("click", () => handleOptionClick(btn, type));
    container.appendChild(btn);
  });
}

function setFeedbackContent(message, useHtml = false) {
  if (!elements.remediationFeedback) return;

  // Style the feedback box
  // Style the feedback box
  elements.remediationFeedback.className = "mt-4 rounded-xl border border-rose-500/50 bg-rose-950/30 p-4 text-center text-sm font-medium text-rose-200 shadow-lg backdrop-blur-sm transition-all duration-300 whitespace-pre-line";

  if (useHtml) {
    elements.remediationFeedback.innerHTML = message;
  } else {
    elements.remediationFeedback.textContent = message;
  }
}

function playReadyGoAnimation() {
  if (!state.config?.startAnimation) {
    return Promise.resolve();
  }

  const overlay = elements.startAnimation;
  const textEl = elements.startAnimationText;
  if (!overlay || !textEl) {
    return Promise.resolve();
  }

  const showPhase = (text, duration = 700) => new Promise((resolve) => {
    overlay.classList.remove("opacity-0");
    overlay.classList.add("opacity-100");

    textEl.textContent = text;
    textEl.classList.remove("opacity-0", "scale-75");
    textEl.classList.add("opacity-100", "scale-100");
    setTimeout(() => {
      textEl.classList.add("opacity-0", "scale-75");
      textEl.classList.remove("opacity-100", "scale-100");
      setTimeout(resolve, 200);
    }, duration);
  });

  return (async () => {
    await showPhase("READY");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await showPhase("GO!");
    textEl.textContent = "";
    overlay.classList.add("opacity-0");
    overlay.classList.remove("opacity-100");
  })();
}

function handleOptionClick(button, type) {
  const challenge = state.activeChallenge;
  if (!challenge || state.challengeStatus !== "active") {
    return;
  }

  const progress = state.challengeProgress?.[type];
  if (!progress || progress.solved) {
    return;
  }

  const maxAttempts = getMaxAttempts();

  const value = button.dataset.optionValue;
  const correctValue =
    type === "formula" ? challenge.correctFormula : challenge.correctName;

  progress.attempts += 1;
  if (progress.attempts > maxAttempts) {
    progress.attempts = maxAttempts;
  }
  state.attempts =
    state.challengeProgress.formula.attempts +
    state.challengeProgress.name.attempts;

  updateColumnTries(type);

  const isCorrect = value === correctValue;

  if (isCorrect) {
    progress.solved = true;
    updateColumnTries(type);
    markOptionResult(type, correctValue, "success");
    elements.remediationFeedback.className = "mt-4 rounded-xl border border-lime-500/50 bg-lime-950/30 p-4 text-center text-sm font-medium text-lime-200 shadow-lg backdrop-blur-sm transition-all duration-300 whitespace-pre-line";
    elements.remediationFeedback.textContent = type === "formula"
      ? "Formula locked in. Now choose the correct name."
      : "Name locked in. Great work!";
    checkChallengeCompletion();
    return;
  }

  // Wrong answer - break streak and reset multiplier
  handleIncorrectAnswer();

  button.disabled = true;
  button.classList.add("border-rose-500", "bg-rose-500/20", "opacity-70");

  const triesRemaining = Math.max(
    0,
    maxAttempts - progress.attempts
  );

  // Get specific feedback for this wrong answer
  const feedbackMap = type === "formula"
    ? challenge.formulaFeedback
    : challenge.nameFeedback;
  const specificFeedback = getFeedbackEntry(feedbackMap, value);

  // Show specific feedback if available, otherwise generic message
  if (specificFeedback) {
    const hasHtml = Boolean(specificFeedback.html);
    const baseMessage = hasHtml ? specificFeedback.html : specificFeedback.text;
    const suffix = triesRemaining > 0
      ? hasHtml
        ? `<br><br>Tries remaining: ${triesRemaining}`
        : `\n\nTries remaining: ${triesRemaining}`
      : "";
    setFeedbackContent(`${baseMessage ?? ""}${suffix}`, hasHtml);
  } else {
    setFeedbackContent(
      triesRemaining > 0
        ? "Not quite. Give it another shot."
        : "Attempts exhausted. Revealing the correct answers."
    );
  }

  if (triesRemaining === 0) {
    handleRemediationFailure();
    return;
  }
}

function checkChallengeCompletion() {
  if (state.challengeStatus !== "active") {
    return;
  }
  const progress = state.challengeProgress;
  if (progress?.formula.solved && progress?.name.solved) {
    completeChallengeSuccess();
  }
}

// ============================================================================
// SCORING FUNCTIONS (Phase 4)
// ============================================================================

/**
 * Calculate score for a completed compound
 * @param {string} compoundKey - The compound key (e.g., "Ag+|F-")
 * @returns {number} - Base points (before multiplier)
 */
function calculateScore(compoundKey) {
  const isFirstTime = !state.sessionCompletedCompounds.has(compoundKey);
  const basePoints = isFirstTime ? scoringRules.firstTimePoints : scoringRules.repeatPoints;
  console.log(`[Score] ${compoundKey}: ${basePoints} pts (${isFirstTime ? 'first time' : 'repeat'})`);
  return basePoints;
}

/**
 * Handle a correct answer - update score, streak, and multiplier
 * @param {string} compoundKey - The compound key
 */
function handleCorrectAnswer(compoundKey) {
  // Calculate base points
  const basePoints = calculateScore(compoundKey);

  // Apply streak multiplier
  const safeMultiplier = getSafeMultiplier(state.streakMultiplier);
  const finalPoints = Math.round(basePoints * safeMultiplier);
  state.score += finalPoints;

  // Increment streak
  state.streakCount++;
  state.bestStreak = Math.max(state.bestStreak || 0, state.streakCount);

  // Update multiplier (soft-growth: +0.25 per correct, cap at 3.0)
  const oldMultiplier = safeMultiplier;
  state.streakMultiplier = Math.min(
    scoringRules.maxMultiplier,
    state.streakMultiplier + scoringRules.multiplierIncrement
  );

  // Mark as completed in this session
  state.sessionCompletedCompounds.add(compoundKey);

  // NEW: Mark as mastered in focus compounds
  state.masteredFocusCompounds.add(compoundKey);

  // NEW: Track solved compounds for current level
  state.currentLevelSolvedCompounds.add(compoundKey);

  // Update level objectives (recalculates requirements based on current mastery)
  checkLevelUpCondition();

  // Update debug panel to reflect mastery
  updateDebugPanel();

  console.log(`[Correct] +${finalPoints} pts (${basePoints} × ${oldMultiplier.toFixed(2)}) | Streak: ${state.streakCount} | Multiplier: ${oldMultiplier.toFixed(2)} → ${state.streakMultiplier.toFixed(2)} | Total: ${state.score}`);
}

/**
 * Handle an incorrect answer - reset streak and multiplier
 */
function handleIncorrectAnswer() {
  const oldStreak = state.streakCount;
  const oldMultiplier = getSafeMultiplier(state.streakMultiplier);

  // Reset streak and multiplier
  // Reset streak and multiplier
  state.streakCount = 0;
  state.streakMultiplier = scoringRules.minMultiplier || 1.0;

  const newMultiplier = state.streakMultiplier;
  console.log(`[Incorrect] Streak broken! ${oldStreak} → 0 | Multiplier: ${oldMultiplier?.toFixed(2) ?? '1.00'} → ${newMultiplier?.toFixed(2) ?? '1.00'}`);
}

// ============================================================================
// CHALLENGE COMPLETION
// ============================================================================

function completeChallengeSuccess() {
  if (state.challengeStatus !== "active") {
    return;
  }
  state.challengeStatus = "succeeded";

  const challenge = state.activeChallenge;
  if (!challenge) {
    return;
  }

  // Build compound key for tracking
  const compoundKey = `${challenge.cation.primarySymbol}|${challenge.anion.primarySymbol}`;

  // Use new scoring system
  const scoreBeforeBonus = state.score;
  handleCorrectAnswer(compoundKey);
  const pointsEarned = state.score - scoreBeforeBonus;

  // Track focus compound mastery
  const isFocusCompound = state.currentLevelFocusCompounds.some(fc => fc.key === compoundKey);
  if (isFocusCompound && !state.masteredFocusCompounds.has(compoundKey)) {
    state.masteredFocusCompounds.add(compoundKey);
    console.log(`[Focus] ✓ Mastered focus compound: ${compoundKey} (${state.masteredFocusCompounds.size}/${state.currentLevelFocusCompounds.length})`);
  }

  // Celebrate with particles!
  const scoreRect = elements.scoreDisplay.getBoundingClientRect();
  celebrate(pointsEarned, {
    x: scoreRect.left + scoreRect.width / 2,
    y: scoreRect.top + scoreRect.height / 2
  });

  applyCompletionState();
  closeModal();
}

function handleRemediationFailure() {
  if (state.challengeStatus && state.challengeStatus !== "active") {
    return;
  }

  state.challengeStatus = "failed";
  // Note: Streak already reset by handleIncorrectAnswer() when wrong answer was clicked
  console.log(`✗ Failed challenge. Score: ${state.score}`);

  ["formula", "name"].forEach((type) => {
    const progress = state.challengeProgress?.[type];
    if (progress) {
      progress.attempts = getMaxAttempts();
    }
  });
  state.attempts =
    (state.challengeProgress?.formula.attempts ?? 0) +
    (state.challengeProgress?.name.attempts ?? 0);

  const challenge = state.activeChallenge;
  elements.remediationFeedback.textContent =
    `Correct formula: ${challenge.correctFormula} • Correct name: ${challenge.correctName}.`;
  elements.acknowledgeButton.classList.remove("hidden");

  revealCorrectAnswer("formula");
  revealCorrectAnswer("name");
  updateColumnTries("formula");
  updateColumnTries("name");
  updateScoreHud();
}

// ============================================================================
// LEVEL-UP LOGIC (Phase 5)
// ============================================================================

/**
 * Classify an ion into a chemical group
 * @param {string} symbol - The ion symbol (e.g., "Li+", "O2-")
 * @returns {string} - The group classification
 */
function getIonGroup(symbol) {
  // Cations
  if (["Li+", "Na+", "K+", "Ag+"].includes(symbol)) return "I";
  if (["Be2+", "Mg2+", "Ca2+", "Sr2+", "Ba2+", "Zn2+"].includes(symbol)) return "II";
  if (["Al3+"].includes(symbol)) return "III";
  if (["NH4+"].includes(symbol)) return "NH4+";

  // Transition Metals
  if (["Cu+"].includes(symbol)) return "TM(I)";
  if (["Cu2+", "Fe2+", "Ni2+", "Pb2+"].includes(symbol)) return "TM(II)";
  if (["Fe3+"].includes(symbol)) return "TM(III)";
  if (["Ti4+", "Pb4+"].includes(symbol)) return "TM(IV)";

  // Less Common TM
  if (["Mn2+", "Co2+", "Pt2+", "Hg2+", "Sn2+"].includes(symbol)) return "TM*(II)";
  if (["V3+", "Cr3+", "Co3+"].includes(symbol)) return "TM*(III)";
  if (["Mn4+", "Pt4+", "Sn4+"].includes(symbol)) return "TM*(IV)";

  // Anions
  if (["F-", "Cl-", "Br-", "I-"].includes(symbol)) return "VII";
  if (["O2-", "S2-"].includes(symbol)) return "VI";
  if (["N3-", "P3-"].includes(symbol)) return "V";

  // Polyatomics
  if (["OH-", "NO3-"].includes(symbol)) return "CP(I)";
  if (["CO32-", "SO42-"].includes(symbol)) return "CP(II)";
  if (["PO43-"].includes(symbol)) return "CP(III)";

  // Less Common CP
  if (["CN-", "SCN-", "NO2-", "BrO3-", "ClO3-", "IO3-"].includes(symbol)) return "CP*(I)";
  if (["CrO42-", "Cr2O72-", "SO32-", "S2O32-"].includes(symbol)) return "CP*(II)";

  return "UNKNOWN";
}

/**
 * Check if the player has met the level-up condition
 * @returns {boolean} - True if player can level up
 */
/**
 * Get the list of unmet requirements for the current level
 * @param {number} level - The level to check
 * @returns {Array} - List of unmet requirement objects
 */
function getUnmetLevelRequirements(level) {
  // Use session-based tracking for current level (fixes level-up bug)
  // This ensures consistency with checkLevelUpCondition() which also uses currentLevelSolvedCompounds
  const masteredCompounds = state.currentLevelSolvedCompounds || new Set();

  // Helper to count matches
  const countMatches = (catGroup, anGroup) => {
    let count = 0;
    masteredCompounds.forEach(key => {
      const [catSym, anSym] = key.split('|');
      const cG = getIonGroup(catSym);
      const aG = getIonGroup(anSym);

      // Allow wildcard matching if group is null/undefined
      const catMatch = !catGroup || cG === catGroup;
      const anMatch = !anGroup || aG === anGroup;

      if (catMatch && anMatch) count++;
    });
    return count;
  };

  const countSpecific = (ionSymbol) => {
    let count = 0;
    masteredCompounds.forEach(key => {
      const [catSym, anSym] = key.split('|');
      if (catSym === ionSymbol || anSym === ionSymbol) count++;
    });
    return count;
  };

  const unmet = [];

  switch (level) {
    case 2: // I and VI, II and VII
      if (countMatches("I", "VI") < 1) unmet.push({ type: 'match', catGroup: "I", anGroup: "VI" });
      if (countMatches("II", "VII") < 1) unmet.push({ type: 'match', catGroup: "II", anGroup: "VII" });
      break;
    case 3: // II and V only
      if (countMatches("II", "V") < 1) unmet.push({ type: 'match', catGroup: "II", anGroup: "V" });
      break;
    case 4: // III and VI must clear at least 1
      if (countMatches("III", "VI") < 1) unmet.push({ type: 'match', catGroup: "III", anGroup: "VI" });
      break;
    case 5: // 1 TM(I) and 1 TM(II)
      if (countMatches("TM(I)", null) < 1) unmet.push({ type: 'match', catGroup: "TM(I)", anGroup: null });
      if (countMatches("TM(II)", null) < 1) unmet.push({ type: 'match', catGroup: "TM(II)", anGroup: null });
      break;
    case 6: // 1 TM(II) and 1 TM(III)
      if (countMatches("TM(II)", null) < 1) unmet.push({ type: 'match', catGroup: "TM(II)", anGroup: null });
      if (countMatches("TM(III)", null) < 1) unmet.push({ type: 'match', catGroup: "TM(III)", anGroup: null });
      break;
    case 7: // 1 TM(III) and 1 TM(IV)
      if (countMatches("TM(III)", null) < 1) unmet.push({ type: 'match', catGroup: "TM(III)", anGroup: null });
      if (countMatches("TM(IV)", null) < 1) unmet.push({ type: 'match', catGroup: "TM(IV)", anGroup: null });
      break;
    case 10: // Must clear at least 1 OH- and NO3-
      if (countSpecific("OH-") < 1) unmet.push({ type: 'specific', symbol: "OH-" });
      if (countSpecific("NO3-") < 1) unmet.push({ type: 'specific', symbol: "NO3-" });
      break;
    case 13: // Must clear CP(III)
      if (countMatches(null, "CP(III)") < 1) unmet.push({ type: 'match', catGroup: null, anGroup: "CP(III)" });
      break;
    case 16: // Must clear TM*(II)
      if (countMatches("TM*(II)", null) < 1) unmet.push({ type: 'match', catGroup: "TM*(II)", anGroup: null });
      break;
    case 17: // At least 1 TM*(III) and 1 TM*(IV)
      if (countMatches("TM*(III)", null) < 1) unmet.push({ type: 'match', catGroup: "TM*(III)", anGroup: null });
      if (countMatches("TM*(IV)", null) < 1) unmet.push({ type: 'match', catGroup: "TM*(IV)", anGroup: null });
      break;
    case 18: // Must clear CP*(I)
      if (countMatches(null, "CP*(I)") < 1) unmet.push({ type: 'match', catGroup: null, anGroup: "CP*(I)" });
      break;
    case 19: // Must clear CP*(II)
      if (countMatches(null, "CP*(II)") < 1) unmet.push({ type: 'match', catGroup: null, anGroup: "CP*(II)" });
      break;
  }

  return unmet;
}

/**
 * Check if the player has met the level-up condition
 * @returns {boolean} - True if player can level up
 */
function checkLevelUpCondition() {
  const level = state.currentLevel;

  // Use the current level's solved compounds for counting
  const masteredCompounds = state.currentLevelSolvedCompounds || new Set();
  const unmet = getUnmetLevelRequirements(level);
  const totalMastered = masteredCompounds.size;

  // Base requirement: Master at least 3 compounds
  const baseRequirementMet = totalMastered >= 3;
  const specificRequirementsMet = unmet.length === 0;

  let canLevelUp = baseRequirementMet && specificRequirementsMet;

  // Special case for Level 20 (Max Level)
  if (level === 20) canLevelUp = false;

  // Generate requirements strings for UI
  let requirements = [];

  // Reconstruct UI strings based on unmet status (simplified for now, or we can keep the switch for UI text generation if needed)
  // To preserve the exact UI text, we might need to keep the switch statement or enhance getUnmetLevelRequirements to return text.
  // For now, let's keep the switch statement for UI text generation but use the new logic for the boolean check.

  // Actually, to avoid code duplication, let's just use the switch for UI text and rely on getUnmetLevelRequirements for logic?
  // Or better, let's rewrite the switch to use getUnmetLevelRequirements implicitly or explicitly.

  // Let's keep the original switch for UI text generation to ensure no regression in display, 
  // but use the new function for logic verification where possible or just trust the refactor.
  // Wait, the user wants the logic extracted to HELP REPLENISHMENT.
  // So I can keep the switch here for UI, but I MUST use getUnmetLevelRequirements in replenishBoard.
  // However, to be clean, I should use the same logic.

  // Let's stick to the original implementation for checkLevelUpCondition for now to minimize risk of breaking UI,
  // but ADD getUnmetLevelRequirements as a separate helper.
  // I will revert the replacement of checkLevelUpCondition and just ADD the new function before it.
  // Wait, I can't revert easily. I will implement both.

  // Re-implementing checkLevelUpCondition using the same logic structure as before for safety, 
  // but adding getUnmetLevelRequirements for the replenishment logic.

  // ... (The implementation below includes both)

  // Helper to count matches (duplicated for now to keep checkLevelUpCondition self-contained or I can make it global scope?)
  // Let's make countMatches a helper inside checkLevelUpCondition as before.

  const countMatches = (catGroup, anGroup) => {
    let count = 0;
    masteredCompounds.forEach(key => {
      const [catSym, anSym] = key.split('|');
      const cG = getIonGroup(catSym);
      const aG = getIonGroup(anSym);
      const catMatch = !catGroup || cG === catGroup;
      const anMatch = !anGroup || aG === anGroup;
      if (catMatch && anMatch) count++;
    });
    return count;
  };

  const countSpecific = (ionSymbol) => {
    let count = 0;
    masteredCompounds.forEach(key => {
      const [catSym, anSym] = key.split('|');
      if (catSym === ionSymbol || anSym === ionSymbol) count++;
    });
    return count;
  };

  switch (level) {
    case 1:
      requirements = [`Master any 3 compounds (${totalMastered}/3)`];
      break;
    case 2:
      const l2_iVi = countMatches("I", "VI");
      const l2_iiVii = countMatches("II", "VII");
      requirements = [
        `Group I + VI: ${l2_iVi >= 1 ? '✓' : '✗'} (${l2_iVi}/1)`,
        `Group II + VII: ${l2_iiVii >= 1 ? '✓' : '✗'} (${l2_iiVii}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 3:
      const l3_iiV = countMatches("II", "V");
      requirements = [
        `Group II + V: ${l3_iiV >= 1 ? '✓' : '✗'} (${l3_iiV}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 4:
      const l4_iiiVi = countMatches("III", "VI");
      requirements = [
        `Group III + VI: ${l4_iiiVi >= 1 ? '✓' : '✗'} (${l4_iiiVi}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 5:
      const l5_tm1 = countMatches("TM(I)", null);
      const l5_tm2 = countMatches("TM(II)", null);
      requirements = [
        `TM(I) compounds: ${l5_tm1 >= 1 ? '✓' : '✗'} (${l5_tm1}/1)`,
        `TM(II) compounds: ${l5_tm2 >= 1 ? '✓' : '✗'} (${l5_tm2}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 6:
      const l6_tm2 = countMatches("TM(II)", null);
      const l6_tm3 = countMatches("TM(III)", null);
      requirements = [
        `TM(II) compounds: ${l6_tm2 >= 1 ? '✓' : '✗'} (${l6_tm2}/1)`,
        `TM(III) compounds: ${l6_tm3 >= 1 ? '✓' : '✗'} (${l6_tm3}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 7:
      const l7_tm3 = countMatches("TM(III)", null);
      const l7_tm4 = countMatches("TM(IV)", null);
      requirements = [
        `TM(III) compounds: ${l7_tm3 >= 1 ? '✓' : '✗'} (${l7_tm3}/1)`,
        `TM(IV) compounds: ${l7_tm4 >= 1 ? '✓' : '✗'} (${l7_tm4}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 8: case 9:
      requirements = [`Master any 3 compounds (${totalMastered}/3)`];
      break;
    case 10:
      const l10_oh = countSpecific("OH-");
      const l10_no3 = countSpecific("NO3-");
      requirements = [
        `OH- compounds: ${l10_oh >= 1 ? '✓' : '✗'} (${l10_oh}/1)`,
        `NO3- compounds: ${l10_no3 >= 1 ? '✓' : '✗'} (${l10_no3}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 11: case 12:
      requirements = [`Master any 3 compounds (${totalMastered}/3)`];
      break;
    case 13:
      const l13_cp3 = countMatches(null, "CP(III)");
      requirements = [
        `CP(III) compounds: ${l13_cp3 >= 1 ? '✓' : '✗'} (${l13_cp3}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 14: case 15:
      requirements = [`Master any 3 compounds (${totalMastered}/3)`];
      break;
    case 16:
      const l16_tmStar2 = countMatches("TM*(II)", null);
      requirements = [
        `TM*(II) compounds: ${l16_tmStar2 >= 1 ? '✓' : '✗'} (${l16_tmStar2}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 17:
      const l17_tmStar3 = countMatches("TM*(III)", null);
      const l17_tmStar4 = countMatches("TM*(IV)", null);
      requirements = [
        `TM*(III) compounds: ${l17_tmStar3 >= 1 ? '✓' : '✗'} (${l17_tmStar3}/1)`,
        `TM*(IV) compounds: ${l17_tmStar4 >= 1 ? '✓' : '✗'} (${l17_tmStar4}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 18:
      const l18_cpStar1 = countMatches(null, "CP*(I)");
      requirements = [
        `CP*(I) compounds: ${l18_cpStar1 >= 1 ? '✓' : '✗'} (${l18_cpStar1}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 19:
      const l19_cpStar2 = countMatches(null, "CP*(II)");
      requirements = [
        `CP*(II) compounds: ${l19_cpStar2 >= 1 ? '✓' : '✗'} (${l19_cpStar2}/1)`,
        `Total (this level): ${totalMastered}/3`
      ];
      break;
    case 20:
      requirements = [
        `🎉 Max Level! Keep mastering compounds!`,
        `Total mastered (this level): ${totalMastered}`
      ];
      break;
    default:
      requirements = [`Master any 3 compounds (${totalMastered}/3)`];
  }

  state.currentLevelRequirements = requirements;

  if (canLevelUp) {
    console.log(`[Level Up Check] ✓ Can level up! Requirements met for Level ${level}`);
  }

  return canLevelUp;
}

/**
 * Level up to the next level
 */
function levelUp() {
  const nextLevelNum = state.currentLevel + 1;
  const nextLevel = state.levels.find((lvl) => lvl.level === nextLevelNum);

  if (!nextLevel) {
    console.log(`[Level Up] Already at max level ${state.currentLevel}`);
    return;
  }

  console.log(`[Level Up] 🎉 Advancing from Level ${state.currentLevel} to Level ${nextLevelNum}`);

  // Save current level progress before transitioning
  saveLevelProgress(state.currentLevel);

  // MEGA celebration for level up!
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  particleSystem.createConfetti(centerX, centerY, 25);

  // Transition to next level after animation
  setTimeout(() => {
    smoothLevelTransition(nextLevel);

    // ** FIX**: Replenish board after level transition
    replenishBoard(state.removedIonsChargeInfo);

    // **FIX**: Update UI to show new level
    updateScoreHud();
  }, 400);
}

/**
 * Save the current level's progress to levelProgress Map
 * @param {number} levelNum - The level number to save
 */
function saveLevelProgress(levelNum) {
  const progress = {
    level: levelNum,
    masteredCompounds: Array.from(state.masteredFocusCompounds),
    completedAt: Date.now()
  };

  state.levelProgress.set(levelNum, progress);
  console.log(`[Level Progress] Saved progress for Level ${levelNum}: ${progress.masteredCompounds.length} mastered compounds`);
}

// ============================================================================
// REPLENISHMENT (Simplified: N removed → N+1 added)
// ============================================================================

function applyCompletionState() {
  // Track what we're removing
  const removedIons = [];
  let totalRemovedCharge = 0;

  state.selectedIons.forEach((entry) => {
    const charge = getIonCharge(entry.species);
    removedIons.push({
      symbol: entry.species.primarySymbol,
      charge: charge,
      species: entry.species
    });
    totalRemovedCharge += charge;

    if (entry.buttonId) {
      state.completedButtonIds.add(entry.buttonId);
      const button = state.buttonRegistry.get(entry.buttonId);
      if (button) {
        animateButtonDisappear(button);
      }
    }
  });

  // Store removed ion info for replacement
  state.removedIonsChargeInfo = {
    totalCharge: totalRemovedCharge,
    ions: removedIons
  };

  console.log(`🗑️ Removed ions: ${removedIons.map(i => i.symbol).join(', ')} (Total charge: ${totalRemovedCharge})`);

  resetIonSelection();
  state.round += 1;

  // NEW: Check for level-up based on focus compound mastery
  if (checkLevelUpCondition()) {
    levelUp();
  } else {
    console.log(`Round ${state.round} - Ready for next challenge!`);
    // Progressive board filling (Phase 6)
    // Wait for animation to finish (500ms) before replenishing
    setTimeout(() => {
      try {
        replenishBoard(state.removedIonsChargeInfo);
      } catch (err) {
        console.error("[Replenish] Error during replenishment:", err);
      }
    }, 600);
  }

  updateScoreHud();
}

/**
 * Replenish the board with new ions after a successful challenge
 * SIMPLE RULE: Remove N ions → Add N+1 ions
 * @param {Object} removedInfo - Info about removed ions {totalCharge, ions[]}
 */
function replenishBoard(removedInfo) {
  if (!elements.boardGrid) {
    console.warn(`[Replenish] Board grid not found`);
    return;
  }

  // Get current level entry
  const levelEntry = state.levels.find(lvl => lvl.level === state.currentLevel);
  if (!levelEntry) {
    console.warn(`[Replenish] Could not find level ${state.currentLevel}`);
    return;
  }

  // Find all wrapper divs in the board grid
  const wrappers = Array.from(elements.boardGrid.children);

  // Find empty slots (wrappers containing holes instead of buttons)
  // Note: After the timeout, the removed buttons should be gone and replaced by holes
  const emptySlots = wrappers.filter(wrapper => {
    const hasButton = wrapper.querySelector('.ion-button');
    return !hasButton; // Empty if no button exists
  });

  // Count current ions on board
  // Exclude any that might still be animating out (just in case)
  const currentIonCount = wrappers.filter(wrapper => {
    const btn = wrapper.querySelector('.ion-button');
    return btn && !btn.classList.contains('ion-button-disappear');
  }).length;

  // Target: maintain boardFillTarget (starts at 8, grows to 16)
  // GROWTH LOGIC: Remove N -> Add N+1
  const removedCount = removedInfo?.ions?.length ?? 0;
  const growthAmount = 1;
  let targetAddCount = removedCount + growthAmount;

  // Update the target size for the board (cap at 16)
  state.boardFillTarget = Math.min(16, state.boardFillTarget + growthAmount);

  // Calculate how many we actually need to add to reach the new target
  // We want to ensure we at least replace what was lost + growth

  // But we must not exceed 16 total ions
  if (currentIonCount + targetAddCount > 16) {
    targetAddCount = 16 - currentIonCount;
  }

  const ionsToAdd = targetAddCount;

  console.log(`[Replenish] Removed ${removedCount}, Adding ${ionsToAdd} (Growth: +${growthAmount}). New Target: ${state.boardFillTarget}`);

  // PRE-VALIDATE: Check if board size can support priority compounds
  if (state.currentLevelFocusCompounds.length > 0) {
    // Get unmet requirements to determine priority compounds
    const unmet = getUnmetLevelRequirements(state.currentLevel);
    let priorityCompounds = state.currentLevelFocusCompounds;

    if (unmet.length > 0) {
      priorityCompounds = state.currentLevelFocusCompounds.filter(fc => {
        const [catSym, anSym] = fc.key.split('|');
        const cG = getIonGroup(catSym);
        const aG = getIonGroup(anSym);

        return unmet.some(req => {
          if (req.type === 'match') {
            const catMatch = !req.catGroup || cG === req.catGroup;
            const anMatch = !req.anGroup || aG === req.anGroup;
            return catMatch && anMatch;
          } else if (req.type === 'specific') {
            return catSym === req.symbol || anSym === req.symbol;
          }
          return false;
        });
      });
    }

    const minRequired = Math.min(priorityCompounds.length, 3);
    const requiredSize = calculateRequiredBoardSize(priorityCompounds.slice(0, 3));

    // If board too small, increase target
    if (state.boardFillTarget < requiredSize) {
      state.boardFillTarget = Math.min(requiredSize, 16);
      console.log(`[Replenish] Increasing board target to ${state.boardFillTarget} to ensure solvability`);
    }
  }

  // Get available ions from the level
  const levelCations = levelEntry.cations.map(s => state.speciesByPrimary.get(s)).filter(Boolean);
  const levelAnions = levelEntry.anions.map(s => state.speciesByPrimary.get(s)).filter(Boolean);
  const allLevelIons = [...levelCations, ...levelAnions];

  if (allLevelIons.length === 0) {
    console.warn(`[Replenish] No ions available for level ${state.currentLevel}`);
    return;
  }

  // Select ions to add, maintaining cation/anion balance
  const newIons = [];
  let cationCount = 0;
  let anionCount = 0;

  const slotsToFill = Math.min(ionsToAdd, emptySlots.length);

  for (let i = 0; i < slotsToFill; i++) {
    let species;

    // Try to maintain balance
    if (cationCount < anionCount && levelCations.length > 0) {
      species = levelCations[Math.floor(Math.random() * levelCations.length)];
      cationCount++;
    } else if (anionCount < cationCount && levelAnions.length > 0) {
      species = levelAnions[Math.floor(Math.random() * levelAnions.length)];
      anionCount++;
    } else {
      // Pick randomly
      species = allLevelIons[Math.floor(Math.random() * allLevelIons.length)];
      if (species.type === 'cation') cationCount++;
      else anionCount++;
    }

    newIons.push(species);
  }

  // Place new ion buttons in empty slots
  newIons.forEach((species, i) => {
    if (i < emptySlots.length) {
      const wrapper = emptySlots[i];

      // Clear the wrapper and create a new ion button
      wrapper.innerHTML = '';
      const button = createIonButton(species);
      button.classList.add('ion-button-appear'); // Add appear animation
      wrapper.appendChild(button);
    }
  });

  console.log(`[Replenish] Added ${newIons.length} ions:`, newIons.map(s => s.primarySymbol).join(', '));

  // Check if board is still solvable after replenishing
  if (state.currentLevelFocusCompounds.length > 0) {
    const currentTokens = getCurrentBoardTokens();

    // SMART SOLVABILITY CHECK:
    // 1. Get unmet requirements
    const unmet = getUnmetLevelRequirements(state.currentLevel);

    // 2. Determine priority compounds
    let priorityCompounds = state.currentLevelFocusCompounds;

    if (unmet.length > 0) {
      // Filter focus compounds to only those that meet an unmet requirement
      priorityCompounds = state.currentLevelFocusCompounds.filter(fc => {
        const [catSym, anSym] = fc.key.split('|');
        const cG = getIonGroup(catSym);
        const aG = getIonGroup(anSym);

        return unmet.some(req => {
          if (req.type === 'match') {
            const catMatch = !req.catGroup || cG === req.catGroup;
            const anMatch = !req.anGroup || aG === req.anGroup;
            return catMatch && anMatch;
          } else if (req.type === 'specific') {
            return catSym === req.symbol || anSym === req.symbol;
          }
          return false;
        });
      });

      // Fallback: If no compounds match requirements (shouldn't happen if config is valid), use all
      if (priorityCompounds.length === 0) {
        console.warn('[Replenish] No compounds match unmet requirements - using all focus compounds');
        priorityCompounds = state.currentLevelFocusCompounds;
      }
    }

    console.log(`[Replenish] Validating against ${priorityCompounds.length} priority compounds (Unmet reqs: ${unmet.length})`);

    if (!validateBoardHasFocusCompounds(currentTokens, priorityCompounds, 1)) {
      console.warn('[Replenish] Board became unsolvable for REQUIREMENTS - regenerating');
      clearAndRegenerateBoard(levelEntry);
    }
  }
}

function fillRemainingSlots(slots, levelEntry, currentIons, existingToAdd = []) {
  // Use smart balance logic for remainder
  let cationCount = currentIons.filter(i => i.type === 'cation').length;
  let anionCount = currentIons.filter(i => i.type === 'anion').length;

  // Account for ions we already decided to add
  existingToAdd.forEach(i => {
    if (i.type === 'cation') cationCount++;
    else anionCount++;
  });

  const levelCations = levelEntry.cations.map(s => state.speciesByPrimary.get(s)).filter(Boolean);
  const levelAnions = levelEntry.anions.map(s => state.speciesByPrimary.get(s)).filter(Boolean);
  const all = [...levelCations, ...levelAnions];

  slots.forEach(slot => {
    let species;
    if (cationCount < anionCount && levelCations.length > 0) {
      species = levelCations[Math.floor(Math.random() * levelCations.length)];
      cationCount++;
    } else if (anionCount < cationCount && levelAnions.length > 0) {
      species = levelAnions[Math.floor(Math.random() * levelAnions.length)];
      anionCount++;
    } else {
      species = all[Math.floor(Math.random() * all.length)];
      if (species.type === 'cation') cationCount++; else anionCount++;
    }

    // Add to existingToAdd array if provided, otherwise write directly (but here we just need to return or write)
    // The original logic wrote directly. Let's write directly to the slot.
    const btn = slot.button;
    btn.disabled = false;
    btn.classList.remove('opacity-0', 'cursor-not-allowed');
    btn.classList.add('hover:bg-slate-700', 'active:bg-slate-600');
    state.completedButtonIds.delete(btn.id);

    const symbolSpan = btn.querySelector('.ion-symbol');
    const chargeSpan = btn.querySelector('.ion-charge');
    if (symbolSpan) symbolSpan.textContent = species.primarySymbol;
    if (chargeSpan) chargeSpan.textContent = formatCharge(species.charge);
    btn.dataset.species = JSON.stringify(species);
  });
}

// Helper functions for Replenish Logic
function countSolvableCompounds(ions, levelEntry) {
  let count = 0;

  // 1. Map available ions to counts
  const availableCounts = new Map();
  ions.forEach(ion => {
    const key = ion.primarySymbol;
    availableCounts.set(key, (availableCounts.get(key) || 0) + 1);
  });

  // 2. Check every possible pairing in the level
  const cations = levelEntry.cations.map(s => state.speciesByPrimary.get(s)).filter(Boolean);
  const anions = levelEntry.anions.map(s => state.speciesByPrimary.get(s)).filter(Boolean);

  cations.forEach(cat => {
    anions.forEach(an => {
      const key = `${cat.primarySymbol}|${an.primarySymbol}`;
      if (state.compoundPairings.has(key)) {
        // Check stoichiometry
        const cCharge = Math.abs(cat.chargeMagnitude);
        const aCharge = Math.abs(an.chargeMagnitude);
        const lcmVal = lcm(cCharge, aCharge);

        const requiredCations = lcmVal / cCharge;
        const requiredAnions = lcmVal / aCharge;

        const availableC = availableCounts.get(cat.primarySymbol) || 0;
        const availableA = availableCounts.get(an.primarySymbol) || 0;

        // We can form floor(available / required) copies
        const possible = Math.min(
          Math.floor(availableC / requiredCations),
          Math.floor(availableA / requiredAnions)
        );

        if (possible > 0) {
          count++; // Count unique solvable compounds (not total instances)
        }
      }
    });
  });

  return count;
}

function getMissingIonsForCompound(cation, anion, currentIons) {
  // Calculate required counts
  const cCharge = Math.abs(cation.chargeMagnitude);
  const aCharge = Math.abs(anion.chargeMagnitude);
  const lcmVal = lcm(cCharge, aCharge);

  const requiredCations = lcmVal / cCharge;
  const requiredAnions = lcmVal / aCharge;

  // Count what we have
  let haveC = 0;
  let haveA = 0;
  currentIons.forEach(ion => {
    if (ion.primarySymbol === cation.primarySymbol) haveC++;
    if (ion.primarySymbol === anion.primarySymbol) haveA++;
  });

  const missing = [];
  for (let i = 0; i < Math.max(0, requiredCations - haveC); i++) missing.push(cation);
  for (let i = 0; i < Math.max(0, requiredAnions - haveA); i++) missing.push(anion);

  return missing;
}

// ============================================================================
// COMPLETION STATE
// ============================================================================



function markOptionResult(type, correctValue, outcome) {
  const container = type === "formula" ? elements.formulaOptions : elements.nameOptions;
  container.querySelectorAll(".option-button").forEach((btn) => {
    btn.disabled = true;
    btn.classList.add("cursor-not-allowed");
    if (btn.dataset.optionValue === correctValue) {
      btn.classList.remove("opacity-70", "border-rose-500", "bg-rose-500/20");
      btn.classList.add(
        outcome === "success" ? "border-lime-400" : "border-lime-300",
        "bg-lime-500/20"
      );
    } else {
      btn.classList.add("opacity-60");
    }
  });
}

function revealCorrectAnswer(type) {
  const challenge = state.activeChallenge;
  if (!challenge) {
    return;
  }
  const correctValue =
    type === "formula" ? challenge.correctFormula : challenge.correctName;
  markOptionResult(type, correctValue, "reveal");
}

function flashInvalidSelection(message) {
  openErrorModal(message);
  resetIonSelection();
}

function setButtonSelectionStyles(button, isActive) {
  if (isActive) {
    button.classList.add("border-lime-500", "ring-4", "ring-lime-300/70", "selection-glow");
  } else {
    button.classList.remove("border-lime-500", "ring-4", "ring-lime-300/70", "selection-glow");
  }
}

function disableIonButton(button) {
  button.disabled = true;
  setButtonSelectionStyles(button, false);
  button.classList.remove("hover:-translate-y-0.5", "hover:shadow-lg");
  button.classList.add("opacity-50", "border-slate-400", "text-slate-500");
}

function createHole() {
  const hole = document.createElement("div");
  hole.className = "w-[85%] h-[85%] box-border rounded-full bg-gradient-to-b from-slate-600 to-slate-700 shadow-[inset_0_4px_8px_rgba(0,0,0,0.5)] border-4 border-slate-800/30";
  return hole;
}

function animateButtonDisappear(button) {
  // Get button position for particle effect
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  // Create small explosion at button position
  particleSystem.createExplosion(x, y, 6);

  button.classList.add("ion-button-disappear");

  // Get the wrapper (parent element)
  const wrapper = button.parentElement;

  setTimeout(() => {
    if (wrapper) {
      wrapper.innerHTML = '';
      wrapper.appendChild(createHole());
    }
  }, 500); // Match animation duration
}

function resetIonSelection() {
  state.selectedIons.forEach((entry) => {
    const button = entry.buttonId ? state.buttonRegistry.get(entry.buttonId) : null;
    if (entry.buttonId) {
      state.selectedButtonIds.delete(entry.buttonId);
    }
    if (button) {
      if (!state.completedButtonIds.has(entry.buttonId) && !state.timeExpired) {
        setButtonSelectionStyles(button, false);
      }
    }
  });
  state.selectedIons = [];
  state.selectedCounts = new Map();
  state.selectionCounter = 0;
  state.selectedButtonIds.clear();
  state.remediationSelection = { formula: null, name: null };
  state.challengeProgress = null;
  state.challengeStatus = null;
  updateSelectionTray();
}

function startTimer() {
  if (state.timerId || state.timeExpired || !state.sessionActive) {
    return;
  }
  state.timerId = window.setInterval(() => {
    state.timeLeft = Math.max(0, state.timeLeft - 1);
    updateTimerHud();

    if (state.timeLeft <= 0) {
      handleTimeExpiry();
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function handleTimeExpiry() {
  if (state.timeExpired) {
    return;
  }
  state.timeExpired = true;
  state.timeLeft = 0;
  stopTimer();
  if (state.challengeStatus === "active") {
    elements.remediationFeedback.textContent = "Time is up!";
    handleRemediationFailure();
  }
  disableBoardInteractions();
  if (!state.activeChallenge) {
    resetIonSelection();
  }
  console.log(`⏱ Time expired! Final Score: ${state.score}, Best Streak: ${state.bestStreak}, Rounds: ${Math.max(1, state.round - 1)}`);
  openEndModal();
}

function disableBoardInteractions() {
  state.buttonRegistry.forEach((btn) => {
    disableIonButton(btn);
  });
  if (elements.submitButton) {
    elements.submitButton.disabled = true;
  }
}


function resetTimeBudget() {
  state.timeLeft = scoringRules.countdownSeconds;
  state.timeExpired = false;
  updateTimerHud();
}

function smoothLevelTransition(nextLevelEntry) {
  state.currentLevel = nextLevelEntry.level;
  saveLevel(nextLevelEntry.level);

  // **FIX**: Reset mastered focus compounds for the new level
  state.masteredFocusCompounds.clear();

  // **FIX**: Clear solved compounds from previous level
  if (state.currentLevelSolvedCompounds) {
    state.currentLevelSolvedCompounds.clear();
  }

  // **FIX**: Generate new focus compounds for this level
  state.currentLevelFocusCompounds = generateFocusCompounds(nextLevelEntry);

  // Reset streak and multiplier for the new level
  // Initialize level objectives for the new level
  checkLevelUpCondition();
  updateLevelObjectives();
  updateDebugPanel();

  // Update the available pool with the new level's ions
  state.availableIonsPool = [];
  const allSymbols = [...nextLevelEntry.cations, ...nextLevelEntry.anions];

  allSymbols.forEach((symbol) => {
    const species = state.speciesByPrimary.get(symbol);
    if (species) {
      state.availableIonsPool.push(species);
    }
  });

  // Add new ions from the new level
  addNewIonsToBoard(state.removedIonsChargeInfo);

  console.log(`📈 Transitioned to Level ${nextLevelEntry.level} - ${nextLevelEntry.rationale}`);
  console.log(`[Level ${nextLevelEntry.level}] New focus compounds: ${state.currentLevelFocusCompounds.length}`);
}

function addNewIonsToBoard(chargeInfo = null) {
  if (!elements.boardGrid || state.availableIonsPool.length === 0) {
    return;
  }

  // Find empty slots
  const emptySlots = Array.from(elements.boardGrid.children).filter(
    wrapper => !wrapper.querySelector('.ion-button')
  );

  if (emptySlots.length === 0) {
    return;
  }

  // Get ions not yet on board from the available pool
  const newIons = state.availableIonsPool.filter(
    species => !state.ionsOnBoard.has(species.primarySymbol)
  );

  // Get all available ions for replacement (including those on board)
  const availableIons = state.availableIonsPool;

  if (availableIons.length === 0) {
    return;
  }

  const targetCharge = chargeInfo?.totalCharge ?? 0;
  const numSlots = emptySlots.length;

  console.log(`🎯 Replacing ions with target charge: ${targetCharge}, slots: ${numSlots}`);

  // Select replacement ions that balance to the target charge
  const tokensToAdd = selectBalancedReplacementIons(
    availableIons,
    targetCharge,
    numSlots
  );

  // Shuffle and add to board
  const shuffledTokens = shuffleArray(tokensToAdd);

  shuffledTokens.forEach((species, index) => {
    if (index < emptySlots.length) {
      const wrapper = emptySlots[index];
      wrapper.innerHTML = '';
      const button = createIonButton(species);
      button.classList.add("ion-button-appear");
      wrapper.appendChild(button);
      state.ionsOnBoard.add(species.primarySymbol);
    }
  });

  if (shuffledTokens.length > 0) {
    const addedCharges = shuffledTokens.map(s => getIonCharge(s));
    const totalAdded = addedCharges.reduce((sum, c) => sum + c, 0);
    console.log(`➕ Added ${shuffledTokens.length} ion(s): ${shuffledTokens.map(s => s.primarySymbol).join(', ')}`);
    console.log(`   Charges: ${addedCharges.join(', ')} = ${totalAdded}`);
  }
}

/**
 * Select a random element from an array
 */
function selectRandom(array) {
  if (!array || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Find ions that will balance to the needed charge
 */
function findBalancingIons(grouped, chargeNeeded, maxSlots) {
  const ions = [];
  let remaining = chargeNeeded;
  let slotsUsed = 0;

  const allGroups = [
    { charge: 3, ions: grouped.plus3 },
    { charge: 2, ions: grouped.plus2 },
    { charge: 1, ions: grouped.plus1 },
    { charge: -1, ions: grouped.minus1 },
    { charge: -2, ions: grouped.minus2 },
    { charge: -3, ions: grouped.minus3 }
  ];

  // Try to balance with as few ions as possible
  while (remaining !== 0 && slotsUsed < maxSlots) {
    let added = false;

    for (const group of allGroups) {
      if (group.ions.length === 0) continue;

      // Check if this charge brings us closer to 0
      if ((remaining > 0 && group.charge > 0 && group.charge <= remaining) ||
        (remaining < 0 && group.charge < 0 && group.charge >= remaining)) {
        ions.push(selectRandom(group.ions));
        remaining -= group.charge;
        slotsUsed++;
        added = true;
        break;
      }
    }

    // If we can't make progress, add a balanced pair
    if (!added) {
      if (grouped.plus1.length > 0 && grouped.minus1.length > 0 && slotsUsed < maxSlots - 1) {
        ions.push(selectRandom(grouped.plus1));
        ions.push(selectRandom(grouped.minus1));
        slotsUsed += 2;
      } else {
        break;
      }
    }
  }

  return ions;
}

/**
 * Select replacement ions that have the same total charge as removed ions
 * and ensure variety of charge magnitudes (±1, ±2, ±3)
 */
function selectBalancedReplacementIons(availableIons, targetCharge, numSlots) {
  // Group available ions by charge
  const grouped = groupIonsByCharge(availableIons);

  const selected = [];
  let currentCharge = 0;

  // Track what charge values we've used for variety
  const usedCharges = new Set();

  // Helper to add an ion to selection
  const addIon = (ion, count = 1) => {
    for (let i = 0; i < count && selected.length < numSlots; i++) {
      selected.push(ion);
      currentCharge += getIonCharge(ion);
      usedCharges.add(getIonCharge(ion));
    }
  };

  // Phase 1: Ensure we have at least one of each charge type for variety
  if (grouped.plus1.length > 0 && selected.length < numSlots) {
    addIon(selectRandom(grouped.plus1), 1);
  }
  if (grouped.minus1.length > 0 && selected.length < numSlots) {
    addIon(selectRandom(grouped.minus1), 1);
  }

  if (grouped.plus2.length > 0 && selected.length < numSlots) {
    addIon(selectRandom(grouped.plus2), 1);
  }
  if (grouped.minus2.length > 0 && selected.length < numSlots) {
    addIon(selectRandom(grouped.minus2), 1);
  }

  if (grouped.plus3.length > 0 && selected.length < numSlots) {
    addIon(selectRandom(grouped.plus3), 1);
  }
  if (grouped.minus3.length > 0 && selected.length < numSlots) {
    addIon(selectRandom(grouped.minus3), 1);
  }

  // Phase 2: Balance remaining charge to reach target (0)
  const chargeNeeded = targetCharge - currentCharge;

  if (chargeNeeded !== 0 && selected.length < numSlots) {
    const slotsLeft = numSlots - selected.length;
    const balancingIons = findBalancingIons(grouped, chargeNeeded, slotsLeft);
    balancingIons.forEach(ion => {
      if (ion) addIon(ion, 1);
    });
  }

  // Phase 3: Fill remaining slots with variety
  while (selected.length < numSlots) {
    const needCharge = targetCharge - currentCharge;

    if (needCharge > 0) {
      // Need positive charge
      const options = [
        ...grouped.plus1,
        ...grouped.plus2,
        ...grouped.plus3
      ].filter(Boolean);
      if (options.length > 0) {
        addIon(selectRandom(options), 1);
      } else break;
    } else if (needCharge < 0) {
      // Need negative charge
      const options = [
        ...grouped.minus1,
        ...grouped.minus2,
        ...grouped.minus3
      ].filter(Boolean);
      if (options.length > 0) {
        addIon(selectRandom(options), 1);
      } else break;
    } else {
      // Perfectly balanced, add matching pair
      if (grouped.plus1.length > 0 && grouped.minus1.length > 0 && selected.length < numSlots - 1) {
        addIon(selectRandom(grouped.plus1), 1);
        addIon(selectRandom(grouped.minus1), 1);
      } else {
        break;
      }
    }
  }

  return selected;
}

function removeSelectionByButtonId(buttonId) {
  const index = state.selectedIons.findIndex((entry) => entry.buttonId === buttonId);
  if (index === -1) {
    return;
  }
  const [removed] = state.selectedIons.splice(index, 1);
  const symbol = removed.species.primarySymbol;
  const nextCount = (state.selectedCounts.get(symbol) ?? 0) - 1;
  if (nextCount > 0) {
    state.selectedCounts.set(symbol, nextCount);
  } else {
    state.selectedCounts.delete(symbol);
  }
  state.selectedButtonIds.delete(buttonId);
  const button = state.buttonRegistry.get(buttonId);
  if (button && !state.completedButtonIds.has(buttonId) && !state.timeExpired) {
    setButtonSelectionStyles(button, false);
  }
  updateSelectionTray();
}

function updateScoreHud() {
  elements.scoreDisplay.textContent = state.score;
  elements.streakDisplay.textContent = state.streakCount ?? 0;
  updateTimerHud();
  updateDebugPanel(); // Update debug panel whenever HUD updates
}

function setDebugPanelVisibility(isVisible) {
  state.debugPanelVisible = Boolean(isVisible);

  if (elements.debugPanel) {
    if (state.debugPanelVisible) {
      elements.debugPanel.classList.remove("hidden");
    } else {
      elements.debugPanel.classList.add("hidden");
    }
  }

  if (elements.debugToggle) {
    elements.debugToggle.setAttribute("aria-pressed", state.debugPanelVisible ? "true" : "false");
    elements.debugToggle.classList.toggle("bg-slate-700", state.debugPanelVisible);
    elements.debugToggle.title = state.debugPanelVisible ? "Hide debug panel" : "Show debug panel";
  }
}

// ============================================================================
// DEBUG PANEL (Phase 7)
// ============================================================================

/**
 * Update the debug panel with current game state
 */
function updateDebugPanel() {
  // Level Info
  const debugLevel = document.getElementById('debug-level');
  const debugRound = document.getElementById('debug-round');

  if (debugLevel) debugLevel.textContent = state.currentLevel;
  if (debugRound) debugRound.textContent = state.round;

  // Score & Streak
  const debugScore = document.getElementById('debug-score');
  const debugStreakCount = document.getElementById('debug-streak-count');
  const debugMultiplier = document.getElementById('debug-multiplier');

  // Guard against an uninitialised multiplier during early startup
  const safeMultiplier = (
    typeof state.streakMultiplier === 'number' && !Number.isNaN(state.streakMultiplier)
      ? state.streakMultiplier
      : (scoringRules?.minMultiplier ?? 1)
  );

  if (debugScore) debugScore.textContent = state.score;
  if (debugStreakCount) debugStreakCount.textContent = state.streakCount;
  if (debugMultiplier) debugMultiplier.textContent = `${safeMultiplier.toFixed(2)}x`;

  // Focus Compounds
  const debugFocusTotal = document.getElementById('debug-focus-total');
  const debugFocusMastered = document.getElementById('debug-focus-mastered');
  const debugFocusProgress = document.getElementById('debug-focus-progress');

  const focusTotal = state.currentLevelFocusCompounds.length;
  const focusMastered = state.masteredFocusCompounds.size;

  if (debugFocusTotal) debugFocusTotal.textContent = focusTotal;
  if (debugFocusMastered) debugFocusMastered.textContent = focusMastered;
  if (debugFocusProgress) {
    const percentage = focusTotal > 0 ? Math.round((focusMastered / focusTotal) * 100) : 0;
    debugFocusProgress.textContent = `${percentage}% (${focusMastered}/${focusTotal})`;
  }

  // Update focus compounds list
  updateFocusCompoundsList();

  // Level species checklist
  updateLevelSpeciesPanel();

  // Level Objectives
  updateLevelObjectives();

  // Solvable Compounds on Board
  updateSolvableCompounds();

  // Session Stats
  const debugSessionCompleted = document.getElementById('debug-session-completed');
  const debugLevelProgress = document.getElementById('debug-level-progress');

  if (debugSessionCompleted) debugSessionCompleted.textContent = state.sessionCompletedCompounds.size;
  if (debugLevelProgress) debugLevelProgress.textContent = state.levelProgress.size;
}

/**
 * Update the solvable compounds display
 */
function updateSolvableCompounds() {
  const countEl = document.getElementById('debug-solvable-count');
  const listEl = document.getElementById('debug-solvable-list');

  if (!countEl || !listEl) return;

  // Get current ions on board
  const currentIons = [];
  document.querySelectorAll('.board-button:not([disabled])').forEach(btn => {
    if (state.completedButtonIds.has(btn.id)) return;
    if (btn.classList.contains('opacity-0')) return;
    try {
      const species = JSON.parse(btn.dataset.species);
      currentIons.push(species);
    } catch (e) { }
  });

  // Get level entry
  const levelEntry = state.levels.find(lvl => lvl.level === state.currentLevel);
  if (!levelEntry) {
    countEl.textContent = '0';
    listEl.innerHTML = '<p class="text-slate-500 italic">No level loaded</p>';
    return;
  }

  // Find all solvable compounds with their required ion counts
  const solvable = [];
  const cations = levelEntry.cations.map(s => state.speciesByPrimary.get(s)).filter(Boolean);
  const anions = levelEntry.anions.map(s => state.speciesByPrimary.get(s)).filter(Boolean);

  // Count available ions
  const availableCounts = new Map();
  currentIons.forEach(ion => {
    const key = ion.primarySymbol;
    availableCounts.set(key, (availableCounts.get(key) || 0) + 1);
  });

  cations.forEach(cat => {
    anions.forEach(an => {
      const key = `${cat.primarySymbol}|${an.primarySymbol}`;
      if (state.compoundPairings.has(key)) {
        // Check stoichiometry
        const cCharge = Math.abs(cat.chargeMagnitude);
        const aCharge = Math.abs(an.chargeMagnitude);
        const lcmVal = lcm(cCharge, aCharge);

        const requiredCations = lcmVal / cCharge;
        const requiredAnions = lcmVal / aCharge;

        const availableC = availableCounts.get(cat.primarySymbol) || 0;
        const availableA = availableCounts.get(an.primarySymbol) || 0;

        // Can we form at least one?
        if (availableC >= requiredCations && availableA >= requiredAnions) {
          const pairing = state.compoundPairings.get(key);
          solvable.push({
            formula: pairing.correct.formula,
            name: pairing.correct.name,
            cation: cat.primarySymbol,
            anion: an.primarySymbol,
            reqC: requiredCations,
            reqA: requiredAnions,
            availC: availableC,
            availA: availableA
          });
        }
      }
    });
  });

  countEl.textContent = solvable.length;

  if (solvable.length === 0) {
    listEl.innerHTML = '<p class="text-slate-500 italic">No solvable compounds</p>';
  } else {
    listEl.innerHTML = solvable
      .map(s => `<div class="text-lime-400">
        ${s.formula} (${s.name})<br>
        <span class="text-[9px] text-slate-400">
          Need: ${s.reqC}×${s.cation} + ${s.reqA}×${s.anion} | 
          Have: ${s.availC}×${s.cation} + ${s.availA}×${s.anion}
        </span>
      </div>`)
      .join('');
  }
}

/**
 * Update the level objectives display
 */
function updateLevelObjectives() {
  const objectivesEl = document.getElementById('debug-level-objectives');
  const statusEl = document.getElementById('debug-level-status');

  if (!objectivesEl) return;

  if (!state.currentLevelRequirements || state.currentLevelRequirements.length === 0) {
    objectivesEl.innerHTML = '<p class="text-slate-500 italic">Loading objectives...</p>';
    if (statusEl) statusEl.textContent = '-';
    return;
  }

  objectivesEl.innerHTML = state.currentLevelRequirements
    .map(req => `<div class="text-sm ${req.includes('✓') ? 'text-lime-400' : 'text-slate-300'}">${req}</div>`)
    .join('');

  // Check if level is complete
  if (statusEl) {
    const levelEntry = state.levels.find(lvl => lvl.level === state.currentLevel);
    if (levelEntry) {
      const canLevelUp = checkLevelUpCondition();

      if (canLevelUp) {
        statusEl.innerHTML = '<span class="text-lime-400">✓ READY TO LEVEL UP!</span>';
      } else {
        statusEl.innerHTML = '<span class="text-amber-300">In Progress</span>';
      }
    } else {
      statusEl.textContent = '-';
    }
  }
}

/**
 * Update the focus compounds list in the debug panel
 */
function updateFocusCompoundsList() {
  const listEl = document.getElementById('debug-focus-list');
  if (!listEl) return;

  if (state.currentLevelFocusCompounds.length === 0) {
    listEl.innerHTML = '<p class="text-slate-500 italic">No focus compounds</p>';
    return;
  }

  listEl.innerHTML = state.currentLevelFocusCompounds
    .map(fc => {
      const isMastered = state.masteredFocusCompounds.has(fc.key);
      const statusIcon = isMastered ? '✓' : '○';
      const statusColor = isMastered ? 'text-lime-400' : 'text-slate-500';
      return `<div class="flex items-start gap-1 ${statusColor}">
        <span class="flex-shrink-0">${statusIcon}</span>
        <span class="flex-1">${fc.name} (${fc.formula})</span>
      </div>`;
    })
    .join('');
}

function updateLevelSpeciesPanel() {
  const summaryEl = document.getElementById('debug-level-species-summary');
  const listEl = document.getElementById('debug-level-species-list');

  if (!summaryEl || !listEl) return;

  const levelData = state.levelSpecies?.[state.currentLevel];
  if (!levelData || !Array.isArray(levelData.compounds)) {
    summaryEl.textContent = "0/0";
    listEl.innerHTML = '<p class="text-slate-500 italic">No level species data</p>';
    return;
  }

  const solvedSet = state.currentLevelSolvedCompounds || new Set();
  const total = levelData.compounds.length;
  const solvedCount = levelData.compounds.reduce(
    (count, compound) => count + (solvedSet.has(compound.key) ? 1 : 0),
    0
  );

  summaryEl.textContent = `${solvedCount}/${total}`;

  const itemsHtml = levelData.compounds
    .slice()
    .sort((a, b) => a.formula.localeCompare(b.formula))
    .map((compound) => {
      const isSolved = solvedSet.has(compound.key);
      const statusIcon = isSolved ? "✓" : "○";
      const statusColor = isSolved ? "text-lime-400" : "text-slate-500";
      return `<div class="flex items-start gap-2 ${statusColor}">
        <span class="flex-shrink-0">${statusIcon}</span>
        <span class="flex-1">${compound.name} (${compound.formula})</span>
      </div>`;
    })
    .join("");

  listEl.innerHTML = itemsHtml || '<p class="text-slate-500 italic">No compounds for this level</p>';
}

function showScorePopup(points, x, y) {
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  popup.textContent = `+${points}`;
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;

  document.body.appendChild(popup);

  setTimeout(() => {
    popup.remove();
  }, 1500);
}

function celebrate(points, buttonPosition) {
  // Create confetti at score display
  const scoreRect = elements.scoreDisplay.getBoundingClientRect();
  const scoreX = scoreRect.left + scoreRect.width / 2;
  const scoreY = scoreRect.top + scoreRect.height / 2;

  particleSystem.createConfetti(scoreX, scoreY, 15);

  // Show score popup
  if (buttonPosition) {
    showScorePopup(points, buttonPosition.x - 50, buttonPosition.y - 40);
  }

  // Streak flash effect
  if (elements.streakDisplay) {
    elements.streakDisplay.parentElement.classList.add('selection-glow');
    setTimeout(() => {
      elements.streakDisplay.parentElement.classList.remove('selection-glow');
    }, 1000);
  }

  console.log(`🎉 CELEBRATION! +${points} points`);
}

function updateTimerHud() {
  const seconds = Math.max(0, Math.round(state.timeLeft));
  elements.timerDisplay.textContent = `${seconds}s`;

  if (state.timeLeft <= scoringRules.warningThreshold && state.timerId) {
    elements.timerDisplay.classList.add("text-rose-500");
  } else {
    elements.timerDisplay.classList.remove("text-rose-500");
  }

  if (elements.timerBar) {
    const denominator = Math.max(1, scoringRules.countdownSeconds);
    const fraction = Math.max(0, Math.min(1, state.timeLeft / denominator));
    elements.timerBar.style.width = `${fraction * 100}%`;
  }
}

function updateColumnTries(type) {
  const target =
    type === "formula" ? elements.formulaTries : elements.nameTries;
  if (!target) {
    return;
  }
  const progress = state.challengeProgress?.[type];
  const attemptsUsed = progress?.attempts ?? 0;
  const remaining = Math.max(0, getMaxAttempts() - attemptsUsed);
  target.textContent = `Tries remaining: ${remaining}`;
}

function openModal() {
  elements.modal.classList.remove("invisible", "opacity-0");
  elements.modal.classList.add("visible", "opacity-100");
  elements.modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  elements.modal.classList.add("opacity-0");
  setTimeout(() => {
    elements.modal.classList.add("invisible");
    elements.modal.classList.remove("visible");
    elements.modal.setAttribute("aria-hidden", "true");
  }, 180);

  resetIonSelection();
  state.activeChallenge = null;
  updateScoreHud();
}

function updateSelectionTray() {
  const tray = elements.selectionTray;
  if (!tray) {
    return;
  }

  tray.innerHTML = "";

  if (state.selectedIons.length === 0) {
    const placeholder = document.createElement("span");
    placeholder.className =
      "text-xs font-semibold uppercase tracking-wide text-amber-500";
    placeholder.textContent = "Tap ions to add/remove them from your attempt.";
    tray.appendChild(placeholder);
  } else {
    const aggregated = new Map();
    state.selectedIons.forEach((entry) => {
      const symbol = entry.species.primarySymbol;
      if (!aggregated.has(symbol)) {
        aggregated.set(symbol, { species: entry.species, count: 0 });
      }
      aggregated.get(symbol).count += 1;
    });

    aggregated.forEach(({ species, count }) => {
      const badge = document.createElement("div");
      badge.className =
        "flex flex-none items-center justify-between gap-4 rounded-full border-2 border-amber-600 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800";

      badge.innerHTML = `
        <div>
          <p class="text-sm font-bold">${species.primarySymbol}</p>
        </div>
        <span class="text-sm font-bold text-lime-700">×${count}</span>
      `;

      tray.appendChild(badge);
    });

    const controls = document.createElement("div");
    controls.className = "flex flex-none items-center gap-2";
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className =
      "rounded-full border border-amber-400 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-600 transition hover:bg-amber-100";
    clearButton.textContent = "Clear";
    clearButton.addEventListener("click", () => {
      resetIonSelection();
    });
    controls.appendChild(clearButton);
    tray.appendChild(controls);
  }

  if (elements.submitButton) {
    elements.submitButton.disabled = !canSubmitSelection();
  }
}

function canSubmitSelection() {
  return state.sessionActive && !state.timeExpired && state.selectedIons.length >= 2;
}

function formatFormulaSegment(formula, count) {
  if (!formula) {
    return "";
  }
  if (count === 1) {
    return formula;
  }
  const needsParens = /[^A-Za-z]/.test(formula) || formula.length > 2;
  return `${needsParens ? `(${formula})` : formula}${count}`;
}

function formatIonSymbolHtml(symbol) {
  if (!symbol) return "";
  const match = symbol.match(/^(.+?)(\d*)([+-])$/);
  if (!match) {
    return symbol.replace(/(\d+)/g, "<sub>$1</sub>");
  }
  const [, body, magnitude, sign] = match;
  const bodyHtml = body.replace(/(\d+)/g, "<sub>$1</sub>");
  const chargeHtml = magnitude ? `<sup>${magnitude}${sign}</sup>` : `<sup>${sign}</sup>`;
  return `${bodyHtml}${chargeHtml}`;
}

function lcm(a, b) {
  const gcdValue = gcd(a, b);
  return Math.abs((a * b) / gcdValue);
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function shuffleArray(array) {
  const clone = array.slice();
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function saveLevel(level) {
  // No-op: localStorage disabled - always start fresh on page load
}

function clearSavedLevel() {
  // No-op: localStorage disabled - always start fresh on page load
}

function runSelectionValidations(selection) {
  const validators = [
    validateChargeDiversity,
    validateIonTypeLimit,
    validateChargeBalance
  ];
  for (const validator of validators) {
    const result = validator(selection);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

function validateChargeDiversity(selection) {
  let hasCation = false;
  let hasAnion = false;
  selection.forEach((entry) => {
    if (entry.species.type === "cation") {
      hasCation = true;
    } else if (entry.species.type === "anion") {
      hasAnion = true;
    }
  });

  if (!hasCation || !hasAnion) {
    return {
      ok: false,
      message: "Ions with the same charge don't form a neutral ionic compound."
    };
  }

  return { ok: true };
}

function validateIonTypeLimit(selection) {
  const uniqueSymbols = new Set(selection.map((entry) => entry.species.primarySymbol));
  if (uniqueSymbols.size > 2) {
    return {
      ok: false,
      message: "Too many different types of ions. Focus on two ions at a time."
    };
  }
  return { ok: true };
}

function validateChargeBalance(selection) {
  if (selection.length === 0) {
    return { ok: false, message: "Select at least two ions before submitting." };
  }

  const totalCharge = selection.reduce((sum, entry) => {
    const chargeValue =
      entry.species.chargeSign === "+" ? entry.species.chargeMagnitude : -entry.species.chargeMagnitude;
    return sum + chargeValue;
  }, 0);

  if (totalCharge !== 0) {
    const summary = summarizeIonCharges(selection);
    return {
      ok: false,
      message: `${summary} • Balance the charges.`
    };
  }

  return { ok: true };
}

function summarizeIonCharges(selection) {
  const map = new Map();
  selection.forEach((entry) => {
    if (!map.has(entry.species.primarySymbol)) {
      map.set(entry.species.primarySymbol, entry.species);
    }
  });

  return Array.from(map.values())
    .map((species) => {
      const sign = species.chargeSign === "+" ? "+" : "-";
      return `${species.primarySymbol} ion charge: ${species.chargeMagnitude}${sign}`;
    })
    .join(" | ");
}

function openStartModal() {
  if (!elements.startModal) {
    return;
  }
  state.sessionActive = false;
  stopTimer();
  elements.startModal.classList.remove("hidden");
  elements.startModal.classList.add("flex");
  elements.startModal.setAttribute("aria-hidden", "false");
}

function closeStartModal() {
  if (!elements.startModal) {
    return;
  }
  elements.startModal.classList.add("hidden");
  elements.startModal.classList.remove("flex");
  elements.startModal.setAttribute("aria-hidden", "true");
}

function openEndModal() {
  if (!elements.endModal) {
    return;
  }

  elements.finalScore.textContent = state.score;
  elements.finalStreak.textContent = state.bestStreak ?? state.streakCount ?? 0;
  elements.finalRounds.textContent = Math.max(1, state.round - 1);

  elements.endModal.classList.remove("hidden");
  elements.endModal.classList.add("flex");
  elements.endModal.setAttribute("aria-hidden", "false");
}

function closeEndModal() {
  if (!elements.endModal) {
    return;
  }
  elements.endModal.classList.add("hidden");
  elements.endModal.classList.remove("flex");
  elements.endModal.setAttribute("aria-hidden", "true");
}

function resetGameState() {
  state.sessionActive = false;
  state.score = 0;
  state.streakCount = 0;
  state.bestStreak = 0;
  state.round = 1;
  state.attempts = 0;
  state.timeExpired = false;
  state.selectedIons = [];
  state.selectedCounts = new Map();
  state.selectionCounter = 0;
  state.selectedButtonIds.clear();
  state.completedIons = new Set();
  state.completedButtonIds = new Set();
  state.activeChallenge = null;
  state.availableIonsPool = [];
  state.ionsOnBoard = new Set();
  state.removedIonsChargeInfo = { totalCharge: 0, ions: [] };
  stopTimer();
  resetTimeBudget();
  updateScoreHud();
  updateSelectionTray();

  // Always restart at the current level when playing again
  if (state.levels.length > 0) {
    const currentLevelNum = state.currentLevel || 1;
    applyLevel(currentLevelNum);
  }
}

function openErrorModal(message) {
  if (!elements.errorModal || !elements.errorMessage) {
    return;
  }
  elements.errorMessage.textContent = message;
  elements.errorModal.classList.remove("invisible", "opacity-0");
  elements.errorModal.classList.add("visible", "opacity-100");
  elements.errorModal.setAttribute("aria-hidden", "false");

  // Add shake effect
  const modalContent = elements.errorModal.querySelector('div');
  if (modalContent) {
    modalContent.classList.add('shake-error');
    setTimeout(() => {
      modalContent.classList.remove('shake-error');
    }, 500);
  }
}

function closeErrorModal() {
  if (!elements.errorModal) {
    return;
  }
  elements.errorModal.classList.add("opacity-0");
  setTimeout(() => {
    elements.errorModal.classList.add("invisible");
    elements.errorModal.classList.remove("visible");
    elements.errorModal.setAttribute("aria-hidden", "true");
  }, 180);
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error("Failed to initialise the prototype:", error);
  });
});
