---
name: Editorial Workshop
colors:
  surface: '#faf8ff'
  surface-dim: '#d0d9fd'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#ebedff'
  surface-container-high: '#e3e7ff'
  surface-container-highest: '#dbe1ff'
  on-surface: '#111a35'
  on-surface-variant: '#434656'
  inverse-surface: '#272f4b'
  inverse-on-surface: '#eff0ff'
  outline: '#737688'
  outline-variant: '#c3c5d9'
  surface-tint: '#004cec'
  primary: '#0044d3'
  on-primary: '#ffffff'
  primary-container: '#1e5bff'
  on-primary-container: '#ecedff'
  inverse-primary: '#b7c4ff'
  secondary: '#5b5f64'
  on-secondary: '#ffffff'
  secondary-container: '#dfe2e9'
  on-secondary-container: '#61656b'
  tertiary: '#a51b0e'
  on-tertiary: '#ffffff'
  tertiary-container: '#c83524'
  on-tertiary-container: '#ffeae6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b7c4ff'
  on-primary-fixed: '#001551'
  on-primary-fixed-variant: '#0039b5'
  secondary-fixed: '#dfe2e9'
  secondary-fixed-dim: '#c3c7cd'
  on-secondary-fixed: '#181c21'
  on-secondary-fixed-variant: '#43474d'
  tertiary-fixed: '#ffdad4'
  tertiary-fixed-dim: '#ffb4a7'
  on-tertiary-fixed: '#400100'
  on-tertiary-fixed-variant: '#910802'
  background: '#faf8ff'
  on-background: '#111a35'
  surface-variant: '#dbe1ff'
typography:
  display-lg:
    fontFamily: hankenGrotesk
    fontSize: 40px
    fontWeight: '800'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: hankenGrotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.4'
  body-lg:
    fontFamily: notoSans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: notoSans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
  label-mono:
    fontFamily: ibmPlexMono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
spacing:
  unit-xs: 4px
  unit-sm: 8px
  unit-md: 16px
  unit-lg: 24px
  unit-xl: 48px
  sidebar-width: 208px
  topbar-height: 56px
---

## Brand & Style

The design system is built on the "Pop Nostalgia Fresh" aesthetic, specifically tailored for high-output professional environments. It bridges the gap between 1990s Chinese editorial departments—characterized by newsprint, ink-heavy stamps, and rigid column structures—and the precision of modern SaaS tooling. 

The emotional response is one of **reliable creativity**: the interface feels like a physical workspace—sturdy, tactile, and clear—while the "pop" elements prevent fatigue during long work sessions. The style avoids modern trends like glassmorphism or neon gradients in favor of **Digital Brutalism Lite**. It uses 1px or 2px "ink" strokes to define the architecture, ensuring that every boundary is intentional. Visual interest is generated through offset printing effects and halftone textures rather than depth or shadows.

## Colors

The palette is inspired by limited-palette silkscreen printing. 

- **Background (#FFFDF7):** A "Warm White" that mimics aged high-quality paper, reducing eye strain compared to pure digital white.
- **Ink Blue-Black (#17203B):** Used for all structural borders (1px/2px), primary text, and iconography. This acts as the "ink" of the system.
- **Cobalt Blue (#1E5BFF):** The high-energy primary action color. It should be used for call-to-actions and active navigation states.
- **Accent Palette:** Tomato Red (#F0523D) for critical risks, Sunflower Yellow (#FFD53D) for warnings, and Mint Green (#8ED9B4) for success. 

**Offset Printing Effect:** For high-level headers or large buttons, a "misregistered" shadow effect is used by offsetting a solid block of Cobalt Blue or Tomato Red 2px to the bottom-right of the primary element.

## Typography

Typography follows a strict hierarchy inspired by newspaper layouts.

- **Headlines:** Use high-impact, heavy weights (Hanken Grotesk as a proxy for digital Chinese display faces like Alibaba PuHuiTi). For major section titles, apply the **Offset Shadow** (2px shift in #1E5BFF).
- **Body:** Focused on legibility. Use Noto Sans for Chinese characters to maintain a clean, modern editorial look. Paragraph spacing should be generous to mimic columned text.
- **Metrics & IDs:** All numerical data, timestamps, and IDs must use **IBM Plex Mono**. This emphasizes the "Engine" aspect of the product, providing a technical, precise contrast to the editorial headings.
- **Labels:** Small caps or mono-spaced labels are used for metadata, often enclosed in 1px boxes to resemble library filing cards.

## Layout & Spacing

This design system utilizes a **Modular Grid** system based on 8px increments. The layout is defined by explicit 1px borders rather than negative space alone, creating a "skeletal" feel.

- **Top Bar:** Fixed at 56px. Features a global search bar that mimics a newspaper "Masthead" search.
- **Sidebar:** Fixed at 208px. This is the primary navigational anchor.
- **Main Canvas:** Uses a flexible modular zone approach. Content is organized into "Panels" defined by 1px #17203B borders. 
- **Dividers:** Use "Newspaper Style Dividers"—these are 1px solid lines, sometimes doubled (1px line, 2px gap, 1px line) for major section breaks.
- **Safe Areas:** 24px internal padding is standard for all primary containers to ensure the "ink" doesn't feel cramped on the "paper."

## Elevation & Depth

This system intentionally rejects shadows and blurs. Depth is conveyed through **Stacking and Outlines**.

- **Level 0 (Base):** The Warm White (#FFFDF7) canvas.
- **Level 1 (Panels):** Defined by 1px #17203B borders. No shadow.
- **Level 2 (Popovers/Drawers):** These use a thicker 2px border. Instead of a shadow, a solid 4px offset block in #17203B (or #1E5BFF for active elements) is used to indicate elevation.
- **Halftone Overlays:** Subtle "dot-matrix" textures are applied to secondary surfaces (like the sidebar background or empty states) to provide a tactile sense of depth without using Z-axis gradients.

## Shapes

The shape language is predominantly **geometric and sharp**.

- **Primary Corners:** 0px (Sharp). This maintains the rigid, professional editorial structure.
- **Interactive Elements:** Small components like checkboxes or tags may use a maximum of 4px radius to feel slightly more "tactile" and modern, but containers and buttons should remain sharp-cornered.
- **Accents:** Circular "Status Dots" (8px) are the only consistent use of perfect rounds, used for sync status or online indicators.

## Components

### Editorial Buttons
Buttons are rectangular with 1px borders. 
- **Primary:** Cobalt Blue background, Warm White text. On hover, a solid 2px offset shadow in Tomato Red appears.
- **Secondary:** Warm White background, Ink Blue-Black text/border.

### Halftone Status Tags
Tags for status (e.g., "Draft", "Published") use a light background color (Mint or Yellow) with a 10% opacity black halftone dot pattern overlaid. This makes them look like printed stamps.

### Sidebar Navigation
- **Active State:** Cobalt Blue (#1E5BFF) background for the entire row. Text changes to Warm White. A 4px vertical "Ink Strike" in Tomato Red (#F0523D) is placed on the far left edge of the active item.

### Input Fields
Fields are simple 1px #17203B underlines or full boxes. The cursor is a non-blinking solid block to mimic terminal or typewriter inputs.

### Newspaper Dividers
Horizontal rules are 1px solid. For "End of Section" markers, use a small 8px solid square or a "checkerboard" segment (4-5 squares) in the center of the line.

### Multi-step Flows
Complexity is handled through **Drawers** that slide from the right. These drawers have a 2px left border and use the secondary surface color (#EEF1F8) to distinguish them from the main working canvas.