import { createTheme, useTheme, type Theme } from '@mui/material/styles';
import { appTheme } from '../../theme';

export type PlannerMode = 'light' | 'dark';

export interface PlannerModeColors {
  background: string;
  onBackground: string;
  textOnBackgroundMuted: string;
  surface: string;
  surfaceMuted: string;
  surfaceHighlight: string;
  border: string;
  borderSoft: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  neutral: string;
  criticalSurface: string;
  warningSurface: string;
  shadowSoft: string;
  shadowStrong: string;
}

export const plannerColors = {
  primary: {
    color: '#fa9549',
    onColor: '#1c1f26',
  },
  secondary: {
    color: '#5f668c',
    onColor: '#ffffff',
  },
  critical: {
    color: '#dc3545',
    onColor: '#fff5f5',
  },
  warning: {
    color: '#fd7e14',
    onColor: '#fff9f0',
  },
  info: {
    color: '#0dcaf0',
    onColor: '#ffffff',
  },
  somersloop: {
    color: '#c77dff',
    glow: 'rgba(199, 125, 255, 0.55)',
  },
  light: {
    background: '#ffffff',
    onBackground: '#1c1f26',
    textOnBackgroundMuted: '#667085',
    surface: '#ffffff',
    surfaceMuted: '#f8f9fb',
    surfaceHighlight: '#fff8e1',
    border: '#e3e3e3',
    borderSoft: '#dddddd',
    textPrimary: '#1c1f26',
    textSecondary: '#555555',
    textMuted: '#667085',
    neutral: '#8a94a6',
    criticalSurface: '#fff5f5',
    warningSurface: '#fff9f0',
    shadowSoft: 'rgb(0 0 0 / 4%)',
    shadowStrong: 'rgb(0 0 0 / 8%)',
  } satisfies PlannerModeColors,
  dark: {
    background: '#1A1C24',
    onBackground: '#ffffff',
    textOnBackgroundMuted: 'rgba(255, 255, 255, 0.7)',
    surface: '#232630',
    surfaceMuted: '#1f222b',
    surfaceHighlight: '#2e2a24',
    border: '#343846',
    borderSoft: '#3d4150',
    textPrimary: '#f5f6f8',
    textSecondary: '#c3c7d1',
    textMuted: '#9aa0ae',
    neutral: '#8a94a6',
    criticalSurface: 'rgba(220, 53, 69, 0.16)',
    warningSurface: 'rgba(253, 126, 20, 0.16)',
    shadowSoft: 'rgb(0 0 0 / 30%)',
    shadowStrong: 'rgb(0 0 0 / 45%)',
  } satisfies PlannerModeColors,
} as const;


export const storageStackPalette = [
  { color: '#4f8cff', bright: '#a8c4ff' },
  { color: '#f2994a', bright: '#ffc38a' },
  { color: '#27ae60', bright: '#7fe0a5' },
  { color: '#9b51e0', bright: '#d2a8ff' },
  { color: '#eb5757', bright: '#ff9d9d' },
  { color: '#2d9cdb', bright: '#8ed8ff' },
  { color: '#f2c94c', bright: '#ffe89a' },
  { color: '#e46ac4', bright: '#ffb3eb' },
  { color: '#6fcf97', bright: '#b6f2cf' },
  { color: '#8a94a6', bright: '#c3c7d1' },
] as const;

const storageItemColorOverrides: Record<string, number> = {
  Desc_PackagedBiofuel_C: 0,
  Desc_Coal_C: 1,
  Desc_IronPlate_C: 2,
};

export const storageStackColor = (itemId: string) => {
  const override = storageItemColorOverrides[itemId];
  if (override !== undefined) return storageStackPalette[override];
  let hash = 0;
  for (const character of itemId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return storageStackPalette[hash % storageStackPalette.length];
};

export const defaultPlannerMode: PlannerMode = 'dark';

export const usePlannerColors = (): PlannerModeColors => {
  const theme = useTheme();
  return plannerColors[theme.palette.mode === 'dark' ? 'dark' : 'light'];
};

export const createPlannerGlobalStyles = (mode: PlannerMode): string => {
  const colors = plannerColors[mode];
  return `
.planner-muted {
  color: ${colors.textMuted};
  font-size: 0.875rem;
}

.planner-section-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.planner-section-head h2 {
  margin-bottom: 0.2rem;
  font-size: 1.35rem;
  word-break: break-word;
}

.planner-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.planner-stat-value {
  margin-bottom: 0.4rem;
  font-size: 1.6rem;
  font-weight: 700;
}

.planner-empty {
  padding: 1.5rem 1rem;
  color: ${colors.textSecondary};
  text-align: center;
}

.planner-details-subhead {
  margin: 1.1rem 0 0.4rem;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${colors.textSecondary};
}

.planner-rate-table {
  margin-bottom: 0;
  font-size: 0.9rem;
}

.planner-diff-subhead {
  margin: 1.75rem 0 0.6rem;
  font-size: 1.1rem;
}

.planner-diff-table {
  font-size: 0.88rem;
}

.planner-diff-list-head {
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${colors.textSecondary};
}

.planner-diff-findings {
  padding-left: 1.1rem;
  font-size: 0.9rem;
}

.planner-diff-findings li {
  margin-bottom: 0.4rem;
}
`;
};

export const createPlannerTheme = (mode: PlannerMode): Theme => {
  const colors = plannerColors[mode];
  return createTheme(appTheme, {
    palette: {
      mode,
      primary: {
        main: plannerColors.primary.color,
        contrastText: plannerColors.primary.onColor,
      },
      secondary: {
        main: plannerColors.secondary.color,
        contrastText: plannerColors.secondary.onColor,
      },
      error: {
        main: plannerColors.critical.color,
        contrastText: plannerColors.critical.onColor,
      },
      warning: {
        main: plannerColors.warning.color,
        contrastText: plannerColors.warning.onColor,
      },
      info: {
        main: plannerColors.info.color,
        contrastText: plannerColors.info.onColor,
      },
      background: {
        default: colors.background,
        paper: colors.surface,
      },
      divider: colors.border,
      text: {
        primary: colors.textPrimary,
        secondary: colors.textMuted,
      },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            border: `1px solid ${colors.border}`,
            boxShadow: `0 1px 2px ${colors.shadowSoft}`,
          },
        },
      },
    },
  });
};

export const plannerThemes: Record<PlannerMode, Theme> = {
  light: createPlannerTheme('light'),
  dark: createPlannerTheme('dark'),
};
