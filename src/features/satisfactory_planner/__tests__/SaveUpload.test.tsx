import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveUpload } from '../components/SaveUpload';

const file = () => new File([new Uint8Array(10)], 'factory.sav');

describe('SaveUpload', () => {
  it('calls onFile for a chosen file', async () => {
    const onFile = vi.fn();
    render(<SaveUpload onFile={onFile} busy={false} />);
    await userEvent.upload(screen.getByLabelText('Choose save'), file());
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('factory.sav');
  });

  it('supports drag and drop and highlights the drop zone', () => {
    const onFile = vi.fn();
    render(<SaveUpload onFile={onFile} busy={false} />);
    const dropZone = screen.getByRole('heading', { name: 'Import a Satisfactory save' })
      .parentElement as HTMLElement;

    fireEvent.dragEnter(dropZone);
    expect(dropZone.className).toContain('is-dragging');
    fireEvent.dragLeave(dropZone);
    expect(dropZone.className).not.toContain('is-dragging');

    fireEvent.drop(dropZone, { dataTransfer: { files: [file()] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('does not accept drops while busy', () => {
    const onFile = vi.fn();
    render(<SaveUpload onFile={onFile} busy />);
    const dropZone = screen.getByRole('heading', { name: 'Import a Satisfactory save' })
      .parentElement as HTMLElement;
    fireEvent.drop(dropZone, { dataTransfer: { files: [file()] } });
    expect(onFile).not.toHaveBeenCalled();
  });

  it('shows progress and a cancel action', async () => {
    const onCancel = vi.fn();
    render(
      <SaveUpload
        onFile={() => undefined}
        busy
        progress={{ phase: 'parsing', progress: 0.42, message: 'Reading levels' }}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText('Reading levels')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows dismissible errors with technical details', async () => {
    const onDismiss = vi.fn();
    render(
      <SaveUpload
        onFile={() => undefined}
        busy={false}
        error={{ code: 'PARSE_FAILED', message: 'Bad save', detail: 'trace' }}
        onDismissError={onDismiss}
      />,
    );
    expect(screen.getByText('Bad save')).toBeInTheDocument();
    expect(screen.getByText('trace')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('lists fixture saves dynamically and loads one', async () => {
    const onFile = vi.fn();
    const blob = new Blob([new Uint8Array(10)]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => blob })));

    render(<SaveUpload onFile={onFile} busy={false} />);
    const select = screen.getByLabelText('Load demo save');
    expect(select).toBeInTheDocument();

    await userEvent.click(select);
    expect(screen.getByRole('option', { name: 'Another-1-2' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Release-032' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'Another-1-2' }));
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(onFile.mock.calls[0][0].name).toBe('Another-1-2.sav');
    vi.unstubAllGlobals();
  });
});
