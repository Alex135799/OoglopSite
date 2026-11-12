import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Home } from './Home';

const renderHome = (underConstruction?: boolean) =>
  render(
    <MemoryRouter>
      <Home underConstruction={underConstruction} />
    </MemoryRouter>,
  );

describe('Home', () => {
  it('renders the background, the three showcase images and the planner entry point', () => {
    renderHome();

    expect(screen.getByAltText('Ooglop site background')).toBeInTheDocument();
    expect(screen.getByAltText('Writing showcase')).toBeInTheDocument();
    expect(screen.getByAltText('Wine showcase')).toBeInTheDocument();
    expect(screen.getByAltText('Money showcase')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open planner' })).toHaveAttribute(
      'href',
      '/planner',
    );
  });

  it('overlays an under-construction banner on every remaining showcase by default', () => {
    renderHome();

    expect(screen.getAllByAltText('Under construction')).toHaveLength(3);
    expect(screen.getAllByRole('img')).toHaveLength(7);
  });

  it('renders only the showcase images when banners are disabled', () => {
    renderHome(false);

    expect(screen.queryByAltText('Under construction')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(4);
  });
});
