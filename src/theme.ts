import { createTheme } from '@mui/material/styles';

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#2f3542' },
    secondary: { main: '#5a3d16' },
    warning: { main: '#ffc107', contrastText: '#212529' },
    background: { default: '#ffffff', paper: '#ffffff' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      '"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid #e3e3e3',
          boxShadow: '0 1px 2px rgb(0 0 0 / 4%)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        label: { fontWeight: 500 },
      },
    },
  },
});
