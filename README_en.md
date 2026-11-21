# BF6 ExperienceManager & Official Plug-ins

A comprehensive guide for the **BF6 ExperienceManager** Google Chrome extension and its companion plug-ins, designed to enhance usability, block editing, and plug-in management in the Battlefield Portal (`https://battlefield.com*`) Rule Editor (Blockly workspace).

---

## 1. Core Extension: BF6 ExperienceManager

### 🧩 Plug-in Manager
* **External Plug-in Support**: Add, enable/disable, update, or remove plug-ins via Manifest URLs (compatible with BF2042 Portal Extensions plug-ins).
* **Startup Modes**: Switch between **Auto Refresh ON** (fetches the latest plug-in code on extension startup) and **Auto Refresh OFF** (uses local cache for fast startup).
* **Error Detection**: Displays load, execution, or runtime errors directly inside the Plug-in Manager UI.

### 🖱️ Enhanced Context Menu & Block Operations
* **Custom "Options" Submenu**: Adds an extensible menu at the top of the right-click context menu for quick access to tools and settings.
* **Block Copy / Cut / Paste**: Copy and paste blocks as JSON via the clipboard, preserving multi-block stack connections and automatically renaming duplicate subroutines.
* **Multi-Block Selection**: Use `Shift + Left-Click` to select multiple blocks and copy or cut them together.
* **Quick Mouse Shortcuts**:
  * **Double-Click**: Toggle block Collapse / Expand.
  * **Middle-Click (Wheel Click)**: Toggle block inputs between Inline (horizontal) and External (vertical).
* **Menu Order Customization**: Enable **Menu Edit ON** to reorder context menu items via drag-and-drop (supports `Ctrl + Z` / `Ctrl + Shift + Z` for Undo/Redo).
* **RED Variable**: Changes variable block colors to a high-contrast dark red theme.

### 🖥️ Workspace Layout & UI Improvements
* **Workspace Expand**: Hides the top title bar, bottom navigation bar, and purchase buttons to maximize the Blockly editing area.
* **Resizable & Sticky Toolbox**:
  * Drag the right border of the left block toolbox to resize its width (double-click to reset to default).
  * Keeps the search bar and results header pinned (sticky) at the top while scrolling.
* **Display Glitch Fix**: Automatically prevents the header on the "My Experiences" list page from disappearing during page transitions.

---

## 2. Companion Plug-ins

Install the following plug-ins via the **Plug-in Manager** to unlock additional productivity features:

### 📦 BF6_CODESTOCK (Snippet & Block Stock Manager)
A hierarchical snippet manager for saving reusable blocks and logic groups and inserting them into your workspace anytime.
* **One-Click Block Registration**: Right-click any block and select **`CODE STOCK`** to open the entry form pre-filled with the block's JSON data.
* **Flexible Insertion (Click or Drag & Drop)**:
  * **Left-Click** a stocked item to paste it automatically into the workspace.
  * **Drag & Drop** an item outside the panel to preview it under your cursor and snap-connect it directly to nearby blocks.
* **Hierarchical Folders & Color Coding**:
  * Organize snippets in up to 8×8 **Parent × Child** folders with a collapsible left tree sidebar.
  * Categorize and filter items using 8 customizable color tags (right-click a color tab to edit) and switch between **Current Tab** and **ALL** search scopes.
  * Right-click an item's title to rename it inline, or use the drag handle (`≡`) to multi-select, reorder, or copy/paste across folders.
* **High-Capacity Storage & Backup**:
  * Uses both IndexedDB and `localStorage` to safely store large snippet libraries.
  * Open Settings (`⚙️`) to **Export / Import JSON** (full library or single tag), **Undo / Redo** (up to 30 steps), and toggle automatic tab synchronization.

### 🛠️ BlockUtility (Editor Productivity Tools)
* **Block Search**: Click the magnifying glass icon in the top-left corner (or use the context menu) to search blocks by type, variable name, or text, highlighting and centering matches on screen.
* **Workspace Minimap**: Click the map icon in the top-left corner to open an interactive overview of your entire workspace with click-to-jump navigation, wheel zoom, and pan support (Rules are highlighted in pink, Subroutines in orange).
* **Subroutine Navigation**:
  * Right-click a subroutine call block → **Go to Subroutine** (cycles through definitions if multiple exist).
  * Right-click a subroutine definition block → **Go to the caller** (jumps to the nearest caller).
* **Auto Rule Numbering**: Right-click `modBlock` and select **Add Rule Numbers** to automatically prefix all child rules sequentially (`01:`, `02:`, etc.) from top to bottom.
* **Toolbox Font Size Control**: Adds a font-size adjustment bar (`10px`–`25px`) to the top of the left block toolbox.
* **Wheel Scrolling**: Use `Shift + Mouse Wheel` to scroll horizontally and `Ctrl + Mouse Wheel` to scroll vertically.

### 📋 Selection_List (Dropdown List Batch Processor & Array Generator)
Right-click any block with a selection dropdown (maps, weapons, vehicles, etc.) or a Rule block (`EVENTTYPE`) and open **`Options > Selection List ▶`**:
* **List → ListSelect**: Opens a searchable list panel supporting multi-selection (`Shift` / `Ctrl` click) and one-click copying of individual or multiple blocks (supports bilingual English/Japanese display and search when the `Japanese` plug-in is active).
* **List → array**: Automatically generates `SetVariableAtIndex` blocks to populate a global array with every item in the list, grouped into collapsed subroutines of up to 256 items each, and copies them to the clipboard.
* **ListName → array / array (J)**: Generates collapsed subroutines storing the item names (or Japanese translations) as text arrays.
* **ListName → File / File (E,J)**: Downloads all list items (or `English,Japanese` pairs) as a `.txt` file.

### 🇯🇵 Japanese (Hover Translation & Localization Helper)
* **Hover Translation Popups**: Hover over blocks in the flyout or workspace, or over editable dropdown fields, to display a large Japanese translation tooltip (toggle ON/OFF anytime via the top-left translation button).
* **Native Help Translation**: Automatically translates English descriptions inside the block **Help** dialog into Japanese.
* **Cross-Plug-in Integration**: Acts as the translation engine for `Selection_List` panels, arrays, and file exports.
* **Cache & Block List Export**: Under **`Options > 日本語キャッシュ ▶`**, export/import your local translation cache as JSON or export a complete JSON catalog of all toolbox categories and blocks.

---

## 3. Installation & Setup

Because this extension uses Chrome's `userScripts` API, you must enable user scripts after installation:

1. Open `chrome://extensions/` in Google Chrome.
2. Enable **Developer mode** in the top-right corner (if loading an unpacked extension).
3. Click **Details** on the **BF6 ExperienceManager** card.
4. Turn ON **Allow User Scripts**.

---

## 4. Shortcuts & Controls

| Action | Function | Provided By |
| :--- | :--- | :--- |
| `Shift + Left-Click` | Multi-select / deselect blocks | Core |
| `Double-Click` | Collapse / expand block | Core |
| `Middle-Click (Wheel)` | Toggle inline / external block inputs | Core |
| `Ctrl + Z` / `Ctrl + Shift + Z` | Undo / Redo menu order changes (in Menu Edit mode) | Core |
| `Shift + Mouse Wheel` | Scroll workspace horizontally | BlockUtility |
| `Ctrl + Mouse Wheel` | Scroll workspace vertically | BlockUtility |
| `Drag outside panel` | Place stocked block directly into workspace & auto-snap | BF6_CODESTOCK |
| `Right-Click item title` | Rename snippet inline | BF6_CODESTOCK |

---

## 5. File Structure

```text
├── manifest.json                 # Extension configuration, permissions, and scripts
├── background.js                 # Plug-in fetching, caching, and Blockly MAIN-world logic
├── content.js                    # Context menu enhancements, UI controls, and layout tweaks
├── popup.html / popup.js         # Plug-in Manager popup UI and logic
├── toolbox-pinned-controls.js    # Sticky positioning for toolbox search bar and headers
├── experiences-display-fix.js    # Visibility guard for the My Experiences header
├── icon.png                      # Extension icon
└── plugins/                      # External plug-ins (loaded via URL)
    ├── BF6_CODESTOCK.js          # Snippet storage, hierarchical folders, and drag placement
    ├── BlockUtility.js           # Search, minimap, subroutine jumps, and rule numbering
    ├── Selection_List.js         # List selector panel and array/subroutine generator
    └── Japanese.js               # Hover tooltips, help dialog translation, and cache tools
```

---

## Requirements
* Google Chrome 120 or later

---

## ■ Disclaimer
The author assumes no responsibility or liability whatsoever for any damages (including, without limitation, loss of data, business interruption, or other financial losses) arising out of the use of or inability to use this software.  
Furthermore, even if defects or bugs exist in this software, the author shall have no obligation to correct or fix them.  
Please use this software entirely at your own risk.
