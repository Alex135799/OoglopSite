import React from 'react';
import background from '../../assets/background.jpg';
import write from '../../assets/write3.jpg';
import wine from '../../assets/wine2.jpg';
import money from '../../assets/money2.jpg';
import mystery from '../../assets/mystery.png';
import underConstruction from '../../assets/underconstruction.jpg';
import { Container, Row, Col, Image } from 'react-bootstrap';
import './Home.css';

type HomeProps = {
  underConstruction?: boolean
}

const addUnderConstruction = (imgUnderConstruction: React.ReactElement) => {
  return (
    <div className="showcase-banner-div">
      <Col xs={{span:8, offset:2}} className="under-construction-div">
        <Image src={underConstruction} alt="Under construction" className="under-construction-img"/>
      </Col>
      <Col xs={12} className="banner-under-construction-div no-padding">
        {imgUnderConstruction}
      </Col>
    </div>
  );
}

export const Home = ({ underConstruction: showBanner = true }: HomeProps) => {
  const withBanner = (img: React.ReactElement) =>
    showBanner ? addUnderConstruction(img) : img

  const writeImg = withBanner(<Image src={write} alt="Writing showcase" fluid/>)
  const wineImg = withBanner(<Image src={wine} alt="Wine showcase" fluid/>)
  const moneyImg = withBanner(<Image src={money} alt="Money showcase" fluid/>)
  const mysteryImg = withBanner(<Image src={mystery} alt="Mystery showcase" fluid/>)

  return (
    <div id="home" className="home-body">
      <Image src={background} alt="Ooglop site background" className="home-bg"/>
      <Container className="showcase" fluid>
        <Row>
          <Col md={6} className="no-padding">
            {writeImg}
          </Col>
          <Col md={6} className="no-padding">
            {wineImg}
          </Col>
          <Col md={6} className="no-padding">
            {moneyImg}
          </Col>
          <Col md={6} className="no-padding">
            {mysteryImg}
          </Col>
        </Row>
      </Container>
    </div>
  );
}
