import React, { lazy, Suspense } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom'
import './App.css';
import { Home } from '../home/Home'
import { Header } from '../header/Header'

import { appTheme } from '../../theme';

const PlannerLayout = lazy(() =>
  import('../../features/satisfactory_planner/PlannerLayout').then((module) => ({ default: module.PlannerLayout })),
);
const PlannerPage = lazy(() =>
  import('../../features/satisfactory_planner/PlannerPage').then((module) => ({ default: module.PlannerPage })),
);

const AppContent = () => {
  const location = useLocation();
  const isFeaturePage = location.pathname.startsWith('/planner');

  return (
    <div className="App">
      {!isFeaturePage && <Header currentPage="home"/>}
      <div id="body" className="App-body">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/planner"
            element={
              <Suspense
                fallback={
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress aria-label="Loading planner" />
                  </Box>
                }
              >
                <PlannerLayout>
                  <PlannerPage />
                </PlannerLayout>
              </Suspense>
            }
          />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>
      <footer className="App-footer" />
    </div>
  );
}

const App = () => {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Router>
        <AppContent />
      </Router>
    </ThemeProvider>
  );
}

export default App;
