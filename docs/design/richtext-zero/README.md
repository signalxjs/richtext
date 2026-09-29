# `@sigx/richtext-zero` design handoff

These are the design references for a zero-styled editor package with swappable skins. They are not shipped code.

- `01`–`07`: the full editor in its different states and skins.
  - `01`: basic skin, floating selection toolbar.
  - `02`: basic skin, slash block menu.
  - `03`: split view with the Markdown source.
  - `04`: source view with the HTML source.
  - `05`: material skin, link popover.
  - `06`: brutalist skin.
  - `07`: carbon skin with the serif document font.
- `08-skins.png`: one toolbar in all six zero design systems.
- `09-anatomy.png`: how each editor part maps to a zero component, plus the API sketch and the icon names.
- `10-lab.png`: `examples/playground` redesigned as the Richtext Lab, core only with no design system: streaming controls, source, the streamed view with each block marked final or open, and the engine inspector.
- `11-showcase.png` and `12-showcase-daisyui.png`: the new `examples/editor` showcase, only `@sigx/richtext-zero`, shown with the Basic and daisyUI skins.
- `source/`: the design files these were rendered from, with the exact per-skin values (colours, radii, fonts, shadows) in the `SKINS` table of `Main.dc.html`. They are HTML with a small template syntax: `{{…}}` holes, `<sc-for>` / `<sc-if>` loops and branches, `<dc-import>` child components.

The skin values are a design reading of each zero skin, not its real tokens. The implementation should use the tokens the `@sigx/zero-*` packages actually ship.
