import { render, screen } from '@testing-library/react';

import App from './App';

describe('App', () => {
  it('renders the header and the home page at the root route', () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByText('Welcome! This is just the start.')).toBeInTheDocument();
    expect(screen.getByAltText('Ooglop site background')).toBeInTheDocument();
  });

  it('falls back to the home page for unknown routes', () => {
    window.history.pushState({}, '', '/does-not-exist');
    render(<App />);

    expect(screen.getByAltText('Ooglop site background')).toBeInTheDocument();
  });
});
