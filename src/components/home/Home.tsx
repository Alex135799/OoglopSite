import React, { Component } from 'react';
import background from '../../assets/background.jpg';
import { Container, Row, Col, Image } from 'react-bootstrap';
import './Home.css';

class Home extends Component {

  render() {
    return (
      <div id="home" className="home-body">
        <Image src={background} className="home-bg"/>
        <Container className="showcase" fluid>
          <Row>
            <Col md={6} className="no-padding">
              <Image src={background} className="showcase-banner" fluid/>
            </Col>
            <Col md={6} className="no-padding">
              <Image src={background} className="showcase-banner" fluid/>
            </Col>
            <Col md={6} className="no-padding">
              <Image src={background} className="showcase-banner" fluid/>
            </Col>
            <Col md={6} className="no-padding">
              <Image src={background} className="showcase-banner" fluid/>
            </Col>
          </Row>
        </Container>
      </div>
    );
  }
}

export default Home;