import { render, screen } from '@testing-library/react';

import { Home } from './Home';

describe('Home', () => {
  it('renders the background and the four showcase images', () => {
    render(<Home />);

    expect(screen.getByAltText('Ooglop site background')).toBeInTheDocument();
    expect(screen.getByAltText('Writing showcase')).toBeInTheDocument();
    expect(screen.getByAltText('Wine showcase')).toBeInTheDocument();
    expect(screen.getByAltText('Money showcase')).toBeInTheDocument();
    expect(screen.getByAltText('Mystery showcase')).toBeInTheDocument();
  });

  it('overlays an under-construction banner on every showcase by default', () => {
    render(<Home />);

    expect(screen.getAllByAltText('Under construction')).toHaveLength(4);
    expect(screen.getAllByRole('img')).toHaveLength(9);
  });

  it('renders only the showcase images when banners are disabled', () => {
    render(<Home underConstruction={false} />);

    expect(screen.queryByAltText('Under construction')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(5);
  });
});
