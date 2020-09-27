import React from 'react';
import background from '../../assets/background.jpg';
import write from '../../assets/write3.jpg';
import wine from '../../assets/wine2.jpg';
import money from '../../assets/money2.jpg';
import mystery from '../../assets/mystery.png';
import underConstruction from '../../assets/underconstruction.jpg';
import { Container, Row, Col, Image } from 'react-bootstrap';
import './Home.css';

const writeUnderConstruction = true;
const wineUnderConstruction = true;
const moneyUnderConstruction = true;
const mysteryUnderConstruction = true;

const addUnderConstruction = (imgUnderConstruction: JSX.Element) => {
  return (
    <div className="showcase-banner-div">
      <Col xs={{span:8, offset:2}} className="under-construction-div">
        <Image src={underConstruction} className="under-construction-img"/>
      </Col>
      <Col xs={12} className="banner-under-construction-div no-padding">
        {imgUnderConstruction}
      </Col>
    </div>
  );
}

export const Home = () => {
  const writeImg = <Image src={write} fluid/>
  const renderWriteImg = writeUnderConstruction ? addUnderConstruction(writeImg) : writeImg
  const wineImg = <Image src={wine} fluid/>
  const renderWineImg = wineUnderConstruction ? addUnderConstruction(wineImg) : wineImg
  const moneyImg = <Image src={money} fluid/>
  const renderMoneyImg = moneyUnderConstruction ? addUnderConstruction(moneyImg) : moneyImg
  const mysteryImg = <Image src={mystery} fluid/>
  const renderMysteryImg = mysteryUnderConstruction ? addUnderConstruction(mysteryImg) : mysteryImg

  return (
    <div id="home" className="home-body">
      <Image src={background} className="home-bg"/>
      <Container className="showcase" fluid>
        <Row>
          <Col md={6} className="no-padding">
            {renderWriteImg}
          </Col>
          <Col md={6} className="no-padding">
            {renderWineImg}
          </Col>
          <Col md={6} className="no-padding">
            {renderMoneyImg}
          </Col>
          <Col md={6} className="no-padding">
            {renderMysteryImg}
          </Col>
        </Row>
      </Container>
    </div>
  );
}