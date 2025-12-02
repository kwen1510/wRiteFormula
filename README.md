# wRiteFormula

A chemistry learning game where players practice writing chemical formulas by matching ions to form compounds. The game features progressive difficulty across 20 levels, streak-based scoring, and a teacher console for configuring game sessions.

## Overview

### Main App (`index.html` + `main.js`)

The main application is an interactive chemistry game where students:

- **Match Ions**: Select ions from a 4×4 grid to form chemical compounds
- **Form Compounds**: Combine cations and anions to create valid chemical formulas
- **Learn Progressively**: Advance through 20 levels, each introducing new concepts:
  - Levels 1-4: Basic charge balance and simple ratios
  - Levels 5-7: Variable oxidation state metals
  - Levels 8-15: Polyatomic ions (ammonium, carbonate, sulfate, nitrate, hydroxide, phosphate)
  - Levels 16-20: Advanced compounds with less common ions
- **Earn Points**: Score points based on first-time vs. repeat compounds, with streak multipliers
- **Level Up**: Progress to higher levels by mastering compounds and meeting specific requirements

**Key Features:**
- Timer-based gameplay (configurable duration)
- Streak tracking and multiplier system
- Remediation system for incorrect answers
- Sound effects and background music
- High score tracking
- Responsive design for mobile and desktop

### Teacher Console (`teacher/index.html`)

The teacher console is a configuration tool that allows educators to:

- **Set Game Duration**: Choose from 1, 2, 3, 4, 5, 7, or 10 minutes
- **Select Starting Level**: Choose any level from 1-20 as the starting point
- **Generate Shareable Links**: Create URLs with embedded configuration parameters
- **QR Code Generation**: Generate QR codes for easy student access
- **View Level Guide**: Access detailed descriptions of all 20 levels and their learning objectives

**Usage:**
1. Select desired game duration
2. Choose starting level
3. Click "Generate Link"
4. Share the link or QR code with students
5. Students access the game with pre-configured settings via URL parameters (`?duration=X&level=Y`)

### Dev vs. Main App

The `dev/` folder contains a development version of the application with the following differences:

| Feature | Main App | Dev App |
|---------|----------|---------|
| **Debug Panel** | Hidden by default (can be toggled) | Visible by default |
| **Functionality** | Production-ready | Development/testing version |
| **Purpose** | Student-facing | Developer testing |

The dev version includes a visible debug panel showing:
- Current level and round information
- Score, streak, and multiplier values
- Level species and objectives
- Session statistics
- Board solvability information

Both versions share the same core game logic and data files.

---

## Game Logic Explained

### 1. Replenishing Logic

**Purpose**: Maintains game flow by refilling the board after successful compound formation.

**How it works:**

1. **Growth Rule**: When N ions are removed from the board (after forming a compound), the game adds **N+1 ions** back
   - This ensures the board gradually grows from an initial size of 8 ions toward a maximum of 16 ions
   - Example: Remove 2 ions → Add 3 ions (net +1)

2. **Board Fill Target**: The game maintains a `boardFillTarget` that starts at 8 and grows by 1 each time ions are replenished, capped at 16

3. **Cation/Anion Balance**: When adding new ions, the system tries to maintain balance:
   - If more anions than cations: preferentially adds cations
   - If more cations than anions: preferentially adds anions
   - Otherwise: random selection from available level ions

4. **Solvability Check**: After replenishing, the game validates that:
   - The board still contains at least one solvable compound
   - Priority compounds (those needed for level-up requirements) are still achievable
   - If unsolvable, the board regenerates completely

5. **Priority Compounds**: The replenishment logic prioritizes compounds that help meet unmet level-up requirements:
   - Filters focus compounds based on unmet requirements
   - Ensures board size can support priority compounds
   - Validates solvability against priority compounds

**Code Location**: `replenishBoard()` function in `main.js` (lines ~2778-2964)

---

### 2. Level Up Logic

**Purpose**: Determines when a player can advance to the next level based on compound mastery.

**Requirements:**

1. **Base Requirement**: Player must master at least **3 compounds** in the current level
   - A compound is "mastered" when successfully formed for the first time in the current level
   - Tracked in `state.currentLevelSolvedCompounds` Set

2. **Specific Requirements**: Each level has unique requirements that must ALL be met:
   - **Level 1**: Master any 3 compounds
   - **Level 2**: Master 1 Group I+VI compound AND 1 Group II+VII compound AND 3 total
   - **Level 3**: Master 1 Group II+V compound AND 3 total
   - **Level 4**: Master 1 Group III+VI compound AND 3 total
   - **Level 5**: Master 1 TM(I) compound AND 1 TM(II) compound AND 3 total
   - **Level 6**: Master 1 TM(II) compound AND 1 TM(III) compound AND 3 total
   - **Level 7**: Master 1 TM(III) compound AND 1 TM(IV) compound AND 3 total
   - **Levels 8-9**: Master any 3 compounds
   - **Level 10**: Master 1 OH⁻ compound AND 1 NO₃⁻ compound AND 3 total
   - **Levels 11-12**: Master any 3 compounds
   - **Level 13**: Master 1 CP(III) compound AND 3 total
   - **Levels 14-15**: Master any 3 compounds
   - **Level 16**: Master 1 TM*(II) compound AND 3 total
   - **Level 17**: Master 1 TM*(III) compound AND 1 TM*(IV) compound AND 3 total
   - **Level 18**: Master 1 CP*(I) compound AND 3 total
   - **Level 19**: Master 1 CP*(II) compound AND 3 total
   - **Level 20**: Maximum level (cannot level up further)

3. **Level Up Process**: When conditions are met:
   - Advances to next level number
   - Resets level-specific tracking (`currentLevelSolvedCompounds`)
   - Loads new level's ions and focus compounds
   - Regenerates board with new level's ions
   - Plays celebration animation and sound
   - Updates UI to show new level

**Code Location**: 
- `checkLevelUpCondition()` function (lines ~2477-2665)
- `levelUp()` function (lines ~2670-2756)
- Called after each successful compound formation

---

### 3. Scoring Logic

**Purpose**: Rewards players with points based on compound mastery and performance streaks.

**Scoring System:**

1. **Base Points**:
   - **First-time compounds**: 100 points (default `firstTimePoints`)
     - Awarded when forming a compound for the first time in the current session
     - Tracked in `state.sessionCompletedCompounds` Set
   - **Repeat compounds**: 50 points (default `repeatPoints`)
     - Awarded when forming a compound that was already completed in the session

2. **Streak Multiplier**:
   - Starts at **1.0x** (minimum multiplier)
   - Increases by **+0.25** for each consecutive correct answer
   - Caps at **3.0x** (maximum multiplier)
   - Example progression: 1.0 → 1.25 → 1.5 → 1.75 → 2.0 → ... → 3.0

3. **Final Score Calculation**:
   ```
   Final Points = Base Points × Streak Multiplier (rounded)
   ```
   - Example: First-time compound (100 pts) × 2.0 multiplier = 200 points
   - Example: Repeat compound (50 pts) × 3.0 multiplier = 150 points

4. **Streak Tracking**:
   - **Streak Count**: Number of consecutive correct answers (increments on correct, resets to 0 on incorrect)
   - **Best Streak**: Highest streak achieved in the session (tracked separately)
   - **Multiplier Reset**: On incorrect answer, multiplier resets to 1.0x and streak count resets to 0

5. **High Score**:
   - Tracks the highest score achieved across all sessions
   - Stored in browser localStorage
   - Displayed in end-game modal
   - Shows "NEW HIGH SCORE!" indicator when beaten

**Scoring Rules Configuration**:
- Configurable via `scoringRules` object
- Can be overridden by teacher console URL parameters
- Default values:
  ```javascript
  {
    firstTimePoints: 100,
    repeatPoints: 50,
    minMultiplier: 1.0,
    maxMultiplier: 3.0,
    multiplierIncrement: 0.25
  }
  ```

**Code Location**:
- `calculateScore()` function (lines ~2196-2201)
- `handleCorrectAnswer()` function (lines ~2207-2243)
- `handleIncorrectAnswer()` function (lines ~2248-2258)

---

## File Structure

```
GITHUB/
├── index.html              # Main app HTML
├── main.js                 # Main app JavaScript (game logic)
├── teacher/
│   └── index.html          # Teacher console
├── dev/                    # Development version
│   ├── index.html
│   ├── main.js
│   └── teacher/
│       └── index.html
├── data/                   # Game data files
│   ├── config.json         # Game configuration
│   ├── levels.json         # Level definitions
│   ├── species_html.json   # Ion species data
│   ├── level_species.json  # Level-species mappings
│   ├── ions.json           # Ion definitions
│   └── compound_pairings_feedback_html.json  # Compound feedback data
└── [Audio files]           # Sound effects and background music
```

## Data Files

- **`config.json`**: Global game configuration
- **`levels.json`**: Defines all 20 levels, their ions, focus compounds, and requirements
- **`species_html.json`**: Ion species definitions (symbols, charges, HTML formatting)
- **`level_species.json`**: Maps levels to available species
- **`ions.json`**: Ion metadata and groupings
- **`compound_pairings_feedback_html.json`**: Feedback messages for compound pairings

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile-responsive design
- Touch-friendly interface for tablets and phones

