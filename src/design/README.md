# Harmonix Design System

This folder contains **all visual decisions** for the Harmonix app. A designer can edit ONLY the files in this folder without touching any application code.

## Files

| File | Purpose | What to edit |
|------|---------|--------------|
| `theme.css` | **Color palette, typography, radii, shadows** | The CSS variables for light and dark themes |
| `README.md` | This file | Documentation only |

## How to edit the design

### Option A: Edit directly in GitHub (fastest)

1. Go to https://github.com/SantiagortegaDev/harmonix-server/blob/main/src/design/theme.css
2. Click the ✏️ pencil icon (top right of the file)
3. Edit the values
4. Click "Commit changes"
5. Vercel auto-deploys in ~30 seconds
6. Reload the app to see your changes

### Option B: Local development (full preview)

```bash
git clone https://github.com/SantiagortegaDev/harmonix-server
cd harmonix-server
npm install
npm run dev
```

Open http://localhost:3000 to see the app, and http://localhost:3000/design-preview to see all components in isolation.

## What you can change

### Colors

All colors use **OKLCH** format: `oklch(L C H)` where:
- `L` = Lightness (0=black, 1=white)
- `C` = Chroma (0=gray, 0.3=fully saturated)
- `H` = Hue angle (0=red, 90=yellow, 180=green, 270=blue, 295=violet)

Visual picker: https://oklch.com/

**To change the brand color**, edit these lines in `theme.css`:

```css
--md-primary: oklch(0.55 0.2 295);          /* Main brand color */
--md-on-primary: oklch(0.98 0.005 295);     /* Text on primary */
--md-primary-container: oklch(0.9 0.06 295);/* Soft brand bg */
--md-on-primary-container: oklch(0.3 0.1 295);/* Text on container */
```

Change the `295` to another hue. Example palettes:

| Name | Primary hue | Surface hue |
|------|-------------|-------------|
| Violet (current) | 295 | 285 |
| Blue | 250 | 240 |
| Green | 145 | 150 |
| Red | 25 | 20 |
| Orange | 55 | 50 |
| Pink | 350 | 340 |
| Teal | 195 | 190 |

### Typography

Font family is set in `src/app/layout.tsx` (Inter by default). To change it:

1. Edit `src/app/layout.tsx` line with `Inter({ subsets: ["latin"] })`
2. Replace with another Google Font, e.g.:
   ```ts
   import { Poppins } from "next/font/google";
   const font = Poppins({ subsets: ["latin"], weight: ["400", "500", "600"] });
   ```

### Border radius

```css
--radius-sm: 8px;   /* Small chips */
--radius-md: 12px;  /* Inputs, small cards */
--radius-lg: 16px;  /* Cards, buttons */
--radius-xl: 28px;  /* FAB, large containers */
```

### Shadows / Elevation

The 5 elevation levels follow Material Design 3. Edit the `--md-elevation-N` variables. To make shadows softer, reduce the opacity values (e.g., `0.30` → `0.15`).

## Design Preview Page

Open `/design-preview` in the browser to see every component with the current theme applied. This is the fastest way to iterate:

1. Open `/design-preview` in one tab
2. Edit `theme.css`
3. Save → hot reload shows changes instantly

## Rules for the designer

✅ **DO**:
- Edit only files in `src/design/`
- Use OKLCH color format (visual picker: https://oklch.com/)
- Test both light and dark themes
- Check `/design-preview` after changes

❌ **DON'T**:
- Edit files outside `src/design/` (unless changing the font in `layout.tsx`)
- Touch `page.tsx`, API routes, or backend code
- Use hex colors (`#FFFFFF`) — use OKLCH for consistency
- Edit `globals.css` — it only imports `theme.css` and defines utilities

## Questions?

Ask the developer. The theme system is intentionally simple so you can focus on the visual identity.
