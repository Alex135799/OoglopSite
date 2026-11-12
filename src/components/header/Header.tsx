import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import './Header.css';

type HeaderProps = {
  currentPage: string
}

export const Header = ({ currentPage }: HeaderProps) => {
  return (
    <AppBar position="fixed" elevation={0} className="header">
      <Toolbar sx={{ justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center', py: 1 }}>
          <Typography component="h2" variant="subtitle1" className="header-text">
            Welcome! This is just the start.
          </Typography>
          <Typography component="h2" variant="subtitle1" className="header-text">
            THE BEST... IS YET... TO COMMEEEEE
          </Typography>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
