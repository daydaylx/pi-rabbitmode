import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createThemeController, RABBIT_THEME_NAME } from "../src/rabbit/theme.ts";
import { createFakeCommandContext } from "./support/fakes.ts";

const THEME_PATH = fileURLToPath(
  new URL("../themes/aurora-rabbit.json", import.meta.url),
);

function loadTheme(): {
  name: string;
  vars: Record<string, string>;
  colors: Record<string, string>;
} {
  return JSON.parse(readFileSync(THEME_PATH, "utf8"));
}

/**
 * The exact required-key set from `theme-schema.json`
 * (`npm/node_modules/@earendil-works/pi-coding-agent/dist/modes/
 * interactive/theme/theme-schema.json` in `daydaylx/pi`). Hardcoded rather
 * than validated against a JSON Schema library — a full validator is more
 * machinery than one closed, rarely-changing key list needs.
 */
const REQUIRED_COLOR_KEYS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode",
] as const;

test("theme file declares the required name and all required color keys", () => {
  const theme = loadTheme();
  assert.equal(theme.name, RABBIT_THEME_NAME);
  for (const key of REQUIRED_COLOR_KEYS) {
    assert.ok(
      Object.hasOwn(theme.colors, key),
      `colors.${key} is required by theme-schema.json but missing`,
    );
  }
});

test("every color role resolves to a var that actually exists", () => {
  const theme = loadTheme();
  for (const [role, varName] of Object.entries(theme.colors)) {
    assert.ok(
      Object.hasOwn(theme.vars, varName),
      `colors.${role} references undefined var "${varName}"`,
    );
  }
});

// --- WCAG relative-luminance contrast, mirroring the check
// `tests/check-theme-contrast.test.mjs` does for daydaylx/pi's own themes
// (a separate repo, not importable here) — re-implemented rather than
// depending across the repository boundary on an internal test helper.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexToRgb(hexA));
  const b = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

function hueDegrees(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

test("normal-text colors clear WCAG AA (>= 4.5:1) against both backgrounds", () => {
  const { vars } = loadTheme();
  const backgrounds = [vars.bg, vars.surface];
  // "dim" is deliberately low-emphasis and sits at the ~4.2:1 UI-component
  // threshold in aurora-forge.json too (verified against daydaylx/pi's own
  // theme, not just asserted) — excluded from the stricter 4.5 bar.
  const normalTextRoles = [
    "text",
    "textMuted",
    "successGreen",
    "warningAmber",
    "errorRed",
    "iceBlue",
    "rabbitWhite",
  ];
  for (const bg of backgrounds) {
    for (const role of normalTextRoles) {
      const ratio = contrastRatio(vars[role]!, bg!);
      assert.ok(
        ratio >= 4.5,
        `${role} (${vars[role]}) vs ${bg}: contrast ${ratio.toFixed(2)} < 4.5`,
      );
    }
  }
});

test("accent blues used as text/interactive elements clear the 3:1 UI-component threshold", () => {
  const { vars } = loadTheme();
  // deepBlue is excluded here: it is used only for `colors.border`, a
  // structural/decorative role, not text or an interactive element.
  for (const role of ["rabbitBlue", "electricBlue"]) {
    const ratio = contrastRatio(vars[role]!, vars.bg!);
    assert.ok(
      ratio >= 3,
      `${role} (${vars[role]}) vs ${vars.bg}: contrast ${ratio.toFixed(2)} < 3`,
    );
  }
});

test("border color (deepBlue) is visible against bg, at the app's own established bar", () => {
  // aurora-forge.json's own `border` color (`gutter`) only reaches 1.66:1
  // against its background — verified directly against that file, not
  // assumed. Borders are decorative, not held to text-contrast bars; this
  // only guards against a border becoming literally invisible (~1:1).
  const { vars } = loadTheme();
  const ratio = contrastRatio(vars.deepBlue!, vars.bg!);
  assert.ok(ratio >= 1.4, `deepBlue vs bg: contrast ${ratio.toFixed(2)} < 1.4`);
});

test("dim stays close to aurora-forge's own established ~4.2:1 baseline", () => {
  const { vars } = loadTheme();
  const ratio = contrastRatio(vars.dim!, vars.bg!);
  assert.ok(ratio >= 3.5, `dim vs bg: contrast ${ratio.toFixed(2)} < 3.5`);
});

test("success/warning/error keep distinct hues (green/amber/red, not confusable)", () => {
  const { vars } = loadTheme();
  const success = hueDegrees(vars.successGreen!);
  const warning = hueDegrees(vars.warningAmber!);
  const error = hueDegrees(vars.errorRed!);

  // Green ~90-170, amber ~35-65, red ~0-20 or ~340-360.
  assert.ok(success > 100 && success < 160, `success hue ${success} not green`);
  assert.ok(warning > 30 && warning < 65, `warning hue ${warning} not amber`);
  assert.ok(error < 20 || error > 340, `error hue ${error} not red`);

  const hueDistance = (a: number, b: number) =>
    Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  assert.ok(hueDistance(success, warning) > 30);
  assert.ok(hueDistance(warning, error) > 30);
  assert.ok(hueDistance(success, error) > 30);
});

test("apply() remembers the current theme and switches to aurora-rabbit", () => {
  const theme = createThemeController();
  const { ctx, setThemeCalls, currentThemeName } = createFakeCommandContext({
    initialThemeName: "aurora-forge",
  });

  const result = theme.apply(ctx as never);

  assert.deepEqual(result, { switched: true });
  assert.deepEqual(setThemeCalls, [RABBIT_THEME_NAME]);
  assert.equal(currentThemeName(), RABBIT_THEME_NAME);
});

test("restore() switches back to the theme active before apply()", () => {
  const theme = createThemeController();
  const { ctx, currentThemeName } = createFakeCommandContext({
    initialThemeName: "aurora-night",
  });

  theme.apply(ctx as never);
  assert.equal(currentThemeName(), RABBIT_THEME_NAME);

  theme.restore(ctx as never);
  assert.equal(currentThemeName(), "aurora-night");
});

test("restore() without a prior successful apply() is a no-op", () => {
  const theme = createThemeController();
  const { ctx, currentThemeName, setThemeCalls } = createFakeCommandContext({
    initialThemeName: "aurora-forge",
  });

  theme.restore(ctx as never);

  assert.equal(currentThemeName(), "aurora-forge");
  assert.equal(setThemeCalls.length, 0);
});

test("a failed apply() reports failure without changing the remembered theme", () => {
  const theme = createThemeController();
  const { ctx, currentThemeName } = createFakeCommandContext({
    initialThemeName: "aurora-forge",
    failThemeNames: [RABBIT_THEME_NAME],
  });

  const result = theme.apply(ctx as never);

  assert.equal(result.switched, false);
  assert.match(result.error ?? "", /not found/);
  assert.equal(currentThemeName(), "aurora-forge");

  // Nothing was remembered by the failed apply, so restore() is a no-op.
  theme.restore(ctx as never);
  assert.equal(currentThemeName(), "aurora-forge");
});

test("reset() drops a pending restore", () => {
  const theme = createThemeController();
  const { ctx, currentThemeName } = createFakeCommandContext({
    initialThemeName: "aurora-day",
  });

  theme.apply(ctx as never);
  theme.reset();
  theme.restore(ctx as never);

  assert.equal(currentThemeName(), RABBIT_THEME_NAME);
});
