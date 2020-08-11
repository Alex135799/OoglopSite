import React, { Component } from 'react';
import logo from '../../assets/logo.svg';
import icon from '../../assets/logo.svg';
import { Container, Row, Col } from 'react-bootstrap';
import './Home.css';

class Home extends Component {

  render() {
    return (
      <div>
        <img src={logo} className="App-logo" alt="logo" />
        <div className="App-desc">
          <Container className="logos">
            <Row>
              <Col className="logo">
                <img src={icon} className="icon-bottom" />
              </Col>
              <Col className="logo">
                <img src={icon} className="App-logo" />
              </Col>
              <Col className="logo">
                <img src={icon} className="icon-bottom" />
              </Col>
            </Row>
          </Container>
        </div>
      </div>
    );
  }
}

export default Home;