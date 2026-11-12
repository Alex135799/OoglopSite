import { describe, expect, it } from 'vitest';
import {
  createPlannerGlobalStyles,
  defaultPlannerMode,
  plannerColors,
  plannerThemes,
} from '../theme';

describe('planner theme', () => {
  it('defaults to dark mode and uses the shared brand colors', () => {
    const theme = plannerThemes[defaultPlannerMode];
    expect(defaultPlannerMode).toBe('dark');
    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.primary.main).toBe(plannerColors.primary.color);
    expect(theme.palette.secondary.main).toBe(plannerColors.secondary.color);
    expect(theme.palette.error.main).toBe(plannerColors.critical.color);
    expect(theme.palette.warning.main).toBe(plannerColors.warning.color);
    expect(theme.palette.info.main).toBe(plannerColors.info.color);
    expect(theme.palette.background.default).toBe(plannerColors.dark.background);
    expect(theme.palette.background.paper).toBe(plannerColors.dark.surface);
    expect(theme.palette.text.primary).toBe(plannerColors.dark.textPrimary);
  });

  it('provides a complete light palette', () => {
    const theme = plannerThemes.light;
    expect(theme.palette.mode).toBe('light');
    expect(theme.palette.background.default).toBe(plannerColors.light.background);
    expect(theme.palette.background.paper).toBe(plannerColors.light.surface);
    expect(theme.palette.text.primary).toBe(plannerColors.light.textPrimary);
  });

  it('generates mode-specific global styles', () => {
    const light = createPlannerGlobalStyles('light');
    const dark = createPlannerGlobalStyles('dark');
    expect(light).toContain('.planner-muted');
    expect(light).toContain('.planner-empty');
    expect(light).toContain(plannerColors.light.textMuted);
    expect(dark).toContain(plannerColors.dark.textMuted);
    expect(light).not.toBe(dark);
  });
});
