import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from './App';

describe('App', () => {
  it('renders the header and the home page at the root route', () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    expect(screen.getByText('Welcome! This is just the start.')).toBeInTheDocument();
    expect(screen.getByAltText('Ooglop site background')).toBeInTheDocument();
  });

  it('renders the lazy planner route at /planner', async () => {
    window.history.pushState({}, '', '/planner');
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Factory Planner' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Satisfactory Planner')).toBeInTheDocument();
    expect(screen.queryByText('Welcome! This is just the start.')).not.toBeInTheDocument();
  });

  it('shows planner info in a conditionally rendered component', async () => {
    window.history.pushState({}, '', '/planner');
    render(<App />);
    await screen.findByRole('heading', { name: 'Factory Planner' });

    await userEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(screen.getByRole('heading', { name: 'Planner info' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What it does' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Planner' }));
    expect(screen.getByRole('heading', { name: 'Factory Planner' })).toBeInTheDocument();
  });

  it('falls back to the home page for unknown routes', () => {
    window.history.pushState({}, '', '/does-not-exist');
    render(<App />);

    expect(screen.getByAltText('Ooglop site background')).toBeInTheDocument();
  });
});
