import { render, screen } from '@testing-library/react';

import { Header } from './Header';

describe('Header', () => {
  it('renders the welcome copy', () => {
    render(<Header currentPage="home" />);

    expect(screen.getByText('Welcome! This is just the start.')).toBeInTheDocument();
    expect(screen.getByText('THE BEST... IS YET... TO COMMEEEEE')).toBeInTheDocument();
  });

  it('renders the messages as headings', () => {
    render(<Header currentPage="home" />);

    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });
});
