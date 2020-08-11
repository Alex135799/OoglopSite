import React, { Component } from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom'
import './App.css';
import Home from '../home/Home'

import { Provider } from 'react-redux';
import configureStore from '../../store/configureStore';

const store = configureStore();

class App extends Component {
  constructor(props : any) {
    super(props);

    this.state = {
      currentPage: "home"
    }
  }

  render() {
    return (
      <Provider store={store}>
        <Router>
          <div className="App">
            <header className="App-header" />
            <div id="body" className="App-body">
              <Switch>
                <Route exact={true} path="/" component={Home} />

                <Route component={Home} />
              </Switch>
            </div>
            <footer className="App-footer" />
          </div>
        </Router>
      </Provider>
    );
  }
}

export default App;