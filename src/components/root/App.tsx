import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'
import './App.css';
import { Home } from '../home/Home'
import { Header } from '../header/Header'

import { Provider } from 'react-redux';
import configureStore from '../../store/configureStore';

const store = configureStore();

const App = () => {
  return (
    <Provider store={store}>
      <Router>
        <div className="App">
          <Header currentPage="home"/>
          <div id="body" className="App-body">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </div>
          <footer className="App-footer" />
        </div>
      </Router>
    </Provider>
  );
}

export default App;
