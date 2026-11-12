import { useEffect, useMemo, useState, type ReactNode } from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import GlobalStyles from '@mui/material/GlobalStyles';
import Switch from '@mui/material/Switch';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { ThemeProvider } from '@mui/material/styles';
import { Link } from 'react-router-dom';
import { PlannerViewContext, type PlannerView } from './plannerView';
import {
  createPlannerGlobalStyles,
  defaultPlannerMode,
  plannerColors,
  plannerThemes,
  type PlannerMode,
} from './theme';

export interface PlannerLayoutProps {
  children: ReactNode;
}

export const PlannerLayout = ({ children }: PlannerLayoutProps) => {
  const [view, setView] = useState<PlannerView>('planner');
  const [mode, setMode] = useState<PlannerMode>(() => {
    try {
      return localStorage.getItem('planner-mode') === 'light' ? 'light' : defaultPlannerMode;
    } catch {
      return defaultPlannerMode;
    }
  });
  const colors = plannerColors[mode];
  const theme = plannerThemes[mode];
  const globalStyles = useMemo(() => createPlannerGlobalStyles(mode), [mode]);

  useEffect(() => {
    try {
      localStorage.setItem('planner-mode', mode);
    } catch {
      // Storage can be unavailable in private browsing; the in-memory mode still works.
    }
  }, [mode]);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles styles={globalStyles} />
      <PlannerViewContext.Provider value={{ view, setView }}>
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: colors.onBackground }}>
        <AppBar
          position="static"
          elevation={0}
          sx={{
            bgcolor: 'background.paper',
            color: 'text.primary',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ gap: 1, flexWrap: 'wrap', py: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={mode === 'dark'}
                  onChange={(_, checked) => setMode(checked ? 'dark' : 'light')}
                  slotProps={{ input: { 'aria-label': 'Dark mode' } }}
                />
              }
              label="Dark"
              sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
            />
            <Typography
              variant="h6"
              component="span"
              sx={{ fontWeight: 700, mr: 2, display: { xs: 'none', sm: 'block' } }}
            >
              Satisfactory Planner
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              color={view === 'planner' ? 'primary' : 'inherit'}
              aria-pressed={view === 'planner'}
              onClick={() => setView('planner')}
            >
              Planner
            </Button>
            <Button
              color={view === 'info' ? 'primary' : 'inherit'}
              aria-pressed={view === 'info'}
              onClick={() => setView('info')}
            >
              Info
            </Button>
            <Button component={Link} to="/" color="inherit">
              Home
            </Button>
          </Toolbar>
        </AppBar>
        {children}
        </Box>
      </PlannerViewContext.Provider>
    </ThemeProvider>
  );
};
