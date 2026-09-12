# Design System: poke.com

> Extracted from [https://poke.com/](https://poke.com/) on 2026-05-14

---

## 1. Visual Theme and Atmosphere

Poke radiates a warm, approachable minimalism with a cream/off-white palette (#FFFDFA) that feels premium yet inviting — closer to paper than screen. Typography is the star: the custom "Exposure" variable display font gives headlines a distinctive, slightly condensed geometric personality, while "OpenRunde" (a rounded sans-serif) softens body text and UI elements. The overall density is low — generous whitespace, centered hero layouts, and large touch targets communicate calm confidence. Photography of real environments (palm trees, natural light) blends with phone mockups, creating a lifestyle-meets-tech aesthetic. Shadows are subtle and layered; depth comes from stacked inset box-shadows rather than dramatic elevation, giving buttons and cards a soft, physical quality.

**Desktop view:**
![](./_assets/desktop.png)

---

## 2. Color Palette and Roles

| Role           | Token / Source         | Hex Value   | Used For                                       |
|----------------|------------------------|-------------|-------------------------------------------------|
| Background     | bg-[#FFFDFA]           | #FFFDFA     | Main page background, hero area                 |
| Surface        | bg-[#EEEBE6]           | #EEEBE6     | Body background, CTA banner surface, tags        |
| Card BG        | (computed)             | #FFFFFF     | Recipe cards, elevated surfaces                  |
| Text Primary   | text-black             | #000000     | Headings, nav links, card titles                 |
| Text Secondary | text-black/70          | rgba(0,0,0,0.7) | Hero subtitle, body paragraphs             |
| Text Muted     | text-black/50          | rgba(0,0,0,0.5) | Card descriptions, captions                |
| Text Dark Alt  | (computed)             | #1C1C1C     | Explore button text, secondary CTAs              |
| Footer Text    | (computed)             | #1A1F2B     | Footer body text                                 |
| Border         | border-[#C7C7C7]       | #C7C7C7     | CTA banner border, muted borders                 |
| Card Border    | (computed)             | #E2E1DE     | Recipe card borders                              |
| Button Dark    | bg-gradient 180deg     | #3A3A3A → #353535 | Primary button gradient, inset ring        |
| Button Ring    | (inset shadow)         | #C9C7C4     | Secondary button inset ring                      |
| Neutral Border | (computed)             | #EEEDED     | Header, global border-color default              |

---

## 3. Typography Rules

**Font families:**
- Display: **Exposure** (variable font, self-hosted via Next.js, variation axis: `EXPO`)
- Body: **OpenRunde** (rounded sans-serif, self-hosted via Next.js)
- Monospace: **JetBrains Mono** (variable font, class on `<html>`, likely code/utility use)

| Level        | Font Family   | Size   | Weight | Line Height | Letter Spacing |
|--------------|---------------|--------|--------|-------------|----------------|
| H1           | Exposure      | 52px   | 600    | 52px (1.0)  | -2.08px        |
| H2           | Exposure      | 48px   | 600    | 57.6px (1.2)| -1.44px        |
| H3 (card)    | OpenRunde     | 18px   | 500    | 24.75px     | normal         |
| Body         | OpenRunde     | 16px   | 500    | 20.8px (1.3)| -0.08px        |
| Nav/Link     | OpenRunde     | 15px   | 500    | 15px (1.0)  | -0.015px       |
| Card Body    | OpenRunde     | 13px   | 400    | 18.2px (1.4)| normal         |
| Caption/Tag  | OpenRunde     | 14px   | 500    | 14px (1.0)  | normal         |
| Mobile H1    | Exposure      | 32px   | 600    | 33.6px (1.05)| -0.96px       |
| Mobile Body  | OpenRunde     | 15px   | 500    | 19.5px (1.3)| -0.08px        |

---

## 4. Component Styles

### Primary Button ("Get Started" — dark)

**Default state:**
![](./_assets/primary-button-default.png)

| Property         | Value                                                                     |
|------------------|---------------------------------------------------------------------------|
| background       | linear-gradient(180deg, #3A3A3A, #353535) (via Tailwind class)            |
| color            | #FFFFFF                                                                   |
| text-shadow      | 0 0.5px 0 rgba(0,0,0,0.5)                                                |
| padding          | 0 20px (nav) / 0 16px (hero)                                             |
| height           | 40px                                                                      |
| border-radius    | 14px                                                                      |
| font-size        | 16px / font-weight: 500                                                   |
| box-shadow       | rgba(0,0,0,0.08) 0 0.5px 1px, rgba(0,0,0,0.1) 0 1px 3px, rgba(0,0,0,0.08) 0 4px 12px, rgb(53,53,53) 0 0 0 1.25px inset, rgba(255,255,255,0.1) 0 0 12px inset |
| transition       | transform 0.15s ease-out, filter 0.15s ease-out                          |

**Hover delta:** scale via transform, slight filter brightness shift
![](./_assets/primary-button-hover.png)

**Focus delta:** outline ring 2px, offset 2px, ring-offset-white
![](./_assets/primary-button-focus.png)

---

### Secondary Button ("Explore" — light)

**Default state:**
![](./_assets/secondary-button-default.png)

| Property         | Value                                                                     |
|------------------|---------------------------------------------------------------------------|
| background       | transparent (gradient overlay in class)                                   |
| color            | #1C1C1C                                                                   |
| padding          | 0 16px                                                                    |
| height           | 40px                                                                      |
| border-radius    | 14px                                                                      |
| font-size        | 16px / font-weight: 500                                                   |
| box-shadow       | rgba(0,0,0,0.04) 0 0.5px 1px, rgba(0,0,0,0.06) 0 1px 3px, rgba(0,0,0,0.04) 0 4px 12px, rgb(201,199,196) 0 0 0 1.25px inset, rgb(255,255,255) 0 0 12.2px inset |
| transition       | transform 0.15s ease-out, filter 0.15s ease-out                          |

**Hover delta:** same transform/filter pattern as primary
![](./_assets/secondary-button-hover.png)

**Focus delta:** outline ring 2px, offset 2px
![](./_assets/secondary-button-focus.png)

---

### Link ("Log in")

**Default state:**
![](./_assets/link-default.png)

| Property         | Value                           |
|------------------|---------------------------------|
| color            | #000000                         |
| font-size        | 15px / font-weight: 500         |
| line-height      | 15px                            |
| letter-spacing   | -0.015px                        |
| text-decoration  | none                            |
| transition       | opacity 0.15s ease              |

**Hover delta:** opacity reduces to ~0.6
![](./_assets/link-hover.png)

**Focus delta:** no visible state change (same as default)
![](./_assets/link-focus.png)

---

### Card (Recipe Card)

**Default state:**
![](./_assets/card-default.png)

| Property         | Value                                                                     |
|------------------|---------------------------------------------------------------------------|
| background-color | #FFFFFF                                                                   |
| border           | 1px solid #E2E1DE                                                         |
| border-radius    | 24px                                                                      |
| padding          | 26px                                                                      |
| gap              | 24px                                                                      |
| max-width        | 400px                                                                     |
| height           | 282px                                                                     |
| box-shadow       | rgba(0,0,0,0.035) 0 1px 2px, rgba(0,0,0,0.035) 0 3px 8px, rgba(0,0,0,0.043) 0 8px 28px |
| transition       | box-shadow 0.25s ease, border-color 0.25s ease                           |
| outline          | rgba(0,0,0,0) solid 2px (offset 2px)                                     |

**Hover delta:** box-shadow intensifies, border-color darkens
![](./_assets/card-hover.png)

**Focus delta:** outline becomes visible (2px solid black, offset 2px)
![](./_assets/card-focus.png)

---

### Input

Not present on the landing page. The product likely uses inputs in the authenticated chat interface.

---

### Nav (Header)

**Default state:**
![](./_assets/nav-default.png)

| Property         | Value                           |
|------------------|---------------------------------|
| display          | flex                            |
| height           | 84px                            |
| max-width        | 1200px                          |
| padding          | 0 40px                          |
| margin           | 0 auto (centered via 120px L/R) |
| font-family      | OpenRunde, sans-serif           |
| color            | #000000                         |
| border-color     | #EEEDED (solid, 0px width)      |

---

### H1 (Hero Heading)

![](./_assets/h1-default.png)

| Property         | Value                           |
|------------------|---------------------------------|
| font-family      | Exposure, sans-serif            |
| font-size        | 52px                            |
| font-weight      | 600                             |
| line-height      | 52px (1.0)                      |
| letter-spacing   | -2.08px (-0.04em)               |
| text-align       | center                          |
| color            | #000000                         |
| font-variation   | 'EXPO' -10 (via class)          |

---

### H2 (Section Heading)

![](./_assets/h2-default.png)

| Property         | Value                           |
|------------------|---------------------------------|
| font-family      | Exposure, sans-serif            |
| font-size        | 48px                            |
| font-weight      | 600                             |
| line-height      | 57.6px (1.2)                    |
| letter-spacing   | -1.44px (-0.03em)               |
| text-align       | center                          |
| color            | #000000                         |

---

### Body Text (Hero Paragraph)

![](./_assets/body-text-default.png)

| Property         | Value                           |
|------------------|---------------------------------|
| font-family      | OpenRunde, sans-serif           |
| font-size        | 16px                            |
| font-weight      | 500                             |
| line-height      | 20.8px (1.3)                    |
| letter-spacing   | -0.08px                         |
| color            | rgba(0,0,0,0.7)                 |
| text-align       | center                          |
| max-width        | 540px                           |

---

### Caption / Card Button

![](./_assets/caption-default.png)

| Property         | Value                           |
|------------------|---------------------------------|
| font-family      | OpenRunde, sans-serif           |
| font-size        | 14px                            |
| font-weight      | 500                             |
| line-height      | 14px                            |
| color            | rgba(0,0,0,0.65)               |
| padding          | 12px 16px                       |
| border           | 1px solid #E0DFDC               |
| border-radius    | 10px                            |
| box-shadow       | rgba(0,0,0,0.05) 0 2px 4px     |
| height           | 40px                            |
| transition       | color 0.2s, bg-image 0.2s, transform 0.2s |

---

## 5. Layout Principles

| Principle            | Value                                              |
|----------------------|----------------------------------------------------|
| Base unit            | 4px (spacing follows 4px grid)                      |
| Spacing scale        | 4, 8, 12, 16, 20, 24, 26, 32, 40, 48, 64, 72, 80 px |
| Border-radius scale  | 6px (links), 10px (small btns), 14px (buttons), 16px (panels), 22-24px (cards), 9999px (pills) |
| Max content width    | 1200px (header), 900px (sections), 540px (body text), 400px (cards) |
| Section gap          | 64px (gap-16), 76px (gap-19)                        |
| Container padding    | 40px horizontal (desktop), 24px (mobile)             |
| Nav height           | 84px (desktop), 72px (mobile)                        |

---

## 6. Depth and Elevation

| Level            | Box Shadow Value                                                           | Usage                    |
|------------------|----------------------------------------------------------------------------|--------------------------|
| 0 (flat)         | none                                                                       | Text, headings           |
| 1 (subtle)       | rgba(0,0,0,0.05) 0 2px 4px                                                | Card buttons, tags       |
| 2 (card)         | rgba(0,0,0,0.035) 0 1px 2px, rgba(0,0,0,0.035) 0 3px 8px, rgba(0,0,0,0.043) 0 8px 28px | Recipe cards    |
| 3 (button)       | rgba(0,0,0,0.08) 0 0.5px 1px, rgba(0,0,0,0.1) 0 1px 3px, rgba(0,0,0,0.08) 0 4px 12px + inset rings | CTA buttons |
| Inset glow       | rgb(255,255,255) 0 0 12px inset                                           | Secondary button inner light |
| Inset ring       | rgb(53,53,53) 0 0 0 1.25px inset (dark) / rgb(201,199,196) 0 0 0 1.25px inset (light) | Button borders via shadow |

This system relies heavily on **layered inset box-shadows** instead of traditional borders for button depth. The inset ring + outer shadow combo creates a soft, physical 3D quality.

---

## 7. Do's and Don'ts

| Do                                                    | Don't                                                   |
|-------------------------------------------------------|---------------------------------------------------------|
| Use the warm off-white #FFFDFA as primary background  | Use pure white #FFF as page background                  |
| Apply Exposure font only for display headings (H1/H2) | Use Exposure for body text or UI labels                 |
| Build button depth with layered inset box-shadows     | Use solid borders on buttons; use single drop-shadows   |
| Keep text at black with opacity (0.5, 0.65, 0.7, 1.0)| Use gray hex values for text (breaks the opacity system)|
| Use 14px border-radius for buttons, 24px for cards    | Mix arbitrary border-radius values                      |
| Center hero content with max-width constraints         | Left-align hero sections or use full-width text          |

---

## 8. Responsive Behavior

**Breakpoints:**

| Name        | Condition              | Typical Use                                  |
|-------------|------------------------|----------------------------------------------|
| Mobile      | < 712px                | Single-column layout, stacked nav, 32px H1   |
| Tablet      | min-width: 712px       | Side-by-side elements, 52px H1, expanded nav |
| Desktop     | min-width: 1200px      | Larger cards (282px height), wider gaps       |

**Touch targets:** minimum 40px height (derived from button height)
**Smallest font size:** 13px on card descriptions (both mobile and desktop)

**Mobile view:**
![](./_assets/mobile.png)

---

## 9. Agent Prompt Guide

**Quick palette:**
> Primary BG #FFFDFA, Surface #EEEBE6, Text #000000, Text Muted rgba(0,0,0,0.5), Card Border #E2E1DE, Button Dark #3A3A3A, Radius 14px (btn) / 24px (card), Font Display: Exposure, Font Body: OpenRunde

**Copy-paste prompts:**

> Build a recipe card: bg #FFFFFF, radius 24px, border 1px solid #E2E1DE,
> shadow (0.035 opacity, 3-layer), padding 26px, gap 24px, font-family OpenRunde,
> heading 18px weight 500, description 13px weight 400 color rgba(0,0,0,0.5), max-width 400px

> Style a primary CTA button: bg linear-gradient(180deg, #3A3A3A, #353535),
> text white with text-shadow 0 0.5px 0 rgba(0,0,0,0.5), padding 0 16px,
> height 40px, radius 14px, font 16px/500 OpenRunde, layered box-shadow with
> inset ring rgb(53,53,53) 0 0 0 1.25px + outer soft shadows, hover: scale(0.98) active

> Style a secondary button: transparent bg, text #1C1C1C, same sizing as primary,
> box-shadow with inset ring rgb(201,199,196) 0 0 0 1.25px + inner glow
> rgb(255,255,255) 0 0 12px inset, hover: same transform pattern

> Create a hero section: centered, max-width 900px, H1 in Exposure font at 52px
> weight 600 tracking -0.04em line-height 1.0, subtitle in OpenRunde 16px/500
> color rgba(0,0,0,0.7) max-width 540px, bg #FFFDFA, generous vertical spacing

---

## Source

| Field              | Value                                                    |
|--------------------|----------------------------------------------------------|
| URL                | https://poke.com/                                        |
| Captured           | 2026-05-14                                               |
| Viewports          | 1440x900, 1920x1080, 390x844                            |
| Assets             | 22 screenshots in `./_assets/`                           |
| Tool versions      | Firecrawl CLI v1.16.2, Playwright MCP                    |
| Known limitations  | Input element not present on landing page; font files self-hosted via Next.js (no external URLs to reference); card screenshots captured from carousel (off-screen positioned elements) |
