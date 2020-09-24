import React from 'react';
import { Navbar } from 'react-bootstrap';
import './Header.css';

type HeaderProps = {
  currentPage: String
}

export const Header = ({ currentPage }: HeaderProps) => {
  return (
    <Navbar bg="dark" fixed="top" className="header" >
      <Navbar.Collapse className="justify-content-center">
        <Navbar.Text>
          <h2 className="header-text">Welcome! This is just the start.</h2>
          <h2 className="header-text">THE BEST... IS YET... TO COMMEEEEE</h2>
        </Navbar.Text>
      </Navbar.Collapse>
    </Navbar>
  );
}