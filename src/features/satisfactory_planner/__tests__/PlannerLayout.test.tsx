import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlannerLayout } from '../PlannerLayout';
import { usePlannerView } from '../plannerView';

const ViewProbe = () => {
  const { view } = usePlannerView();
  return <div>view:{view}</div>;
};

const renderLayout = () =>
  render(
    <MemoryRouter>
      <PlannerLayout>
        <ViewProbe />
      </PlannerLayout>
    </MemoryRouter>,
  );

describe('PlannerLayout', () => {
  beforeEach(() => localStorage.clear());

  it('renders the planner navigation and content', () => {
    renderLayout();
    expect(screen.getByText('Satisfactory Planner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Info' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByText('view:planner')).toBeInTheDocument();
  });

  it('defaults to dark mode and persists the toggle', async () => {
    renderLayout();
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
    expect(localStorage.getItem('planner-mode')).toBe('dark');

    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem('planner-mode')).toBe('light');

    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(localStorage.getItem('planner-mode')).toBe('dark');
  });

  it('switches between planner and info views', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(screen.getByText('view:info')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Info' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Planner' }));
    expect(screen.getByText('view:planner')).toBeInTheDocument();
  });
});
