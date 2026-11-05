import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';
import background from '../../assets/background.jpg';
import write from '../../assets/write3.jpg';
import wine from '../../assets/wine2.jpg';
import money from '../../assets/money2.jpg';
import underConstruction from '../../assets/underconstruction.jpg';
import './Home.css';

type HomeProps = {
  underConstruction?: boolean
}

const ShowcaseImage = ({ src, alt }: { src: string; alt: string }) => (
  <Box component="img" src={src} alt={alt} sx={{ width: '100%', display: 'block' }} />
);

const addUnderConstruction = (imgUnderConstruction: React.ReactElement) => {
  return (
    <Box className="showcase-banner-div">
      <Box className="under-construction-div" sx={{ width: '66.6667%', mx: 'auto' }}>
        <Box
          component="img"
          src={underConstruction}
          alt="Under construction"
          className="under-construction-img"
        />
      </Box>
      <Box className="banner-under-construction-div">
        {imgUnderConstruction}
      </Box>
    </Box>
  );
}

export const Home = ({ underConstruction: showBanner = true }: HomeProps) => {
  const withBanner = (img: React.ReactElement) =>
    showBanner ? addUnderConstruction(img) : img;

  const writeImg = withBanner(<ShowcaseImage src={write} alt="Writing showcase" />);
  const wineImg = withBanner(<ShowcaseImage src={wine} alt="Wine showcase" />);
  const moneyImg = withBanner(<ShowcaseImage src={money} alt="Money showcase" />);

  return (
    <Box id="home" className="home-body">
      <Box component="img" src={background} alt="Ooglop site background" className="home-bg" />
      <Container maxWidth={false} disableGutters className="showcase">
        <Box className="showcase-grid">
          <Box>{writeImg}</Box>
          <Box>{wineImg}</Box>
          <Box>{moneyImg}</Box>
          <Box>
            <Box className="planner-tile">
              <Box className="planner-tile-content">
                <Typography
                  variant="h3"
                  component="h3"
                  sx={{
                    mb: 2,
                    fontSize: { xs: '1.8rem', md: '2.3rem', lg: '2.8rem' },
                    fontWeight: 700,
                    letterSpacing: '0.02em',
                  }}
                >
                  Factory Planner
                </Typography>
                <p>
                  Import a Satisfactory save and see supply lines, estimated bottlenecks,
                  and power at a glance. Everything runs in your browser.
                </p>
                <Button
                  component={Link}
                  to="/planner"
                  variant="contained"
                  color="warning"
                  className="planner-tile-link"
                >
                  Open planner
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
