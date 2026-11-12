import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ParseProgress, PlannerError } from '../domain/types';
import { progressLabel } from '../api/plannerError';
import { usePlannerColors } from '../theme';

const demoSaveModules = import.meta.glob('../fixtures/*.sav', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const demoSaves = Object.entries(demoSaveModules)
  .map(([path, url]) => ({
    name: path.split('/').pop() ?? path,
    url,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export interface SaveUploadProps {
  onFile: (file: File) => void;
  busy: boolean;
  progress?: ParseProgress;
  error?: PlannerError;
  onDismissError?: () => void;
  onCancel?: () => void;
}

export const SaveUpload = ({
  onFile,
  busy,
  progress,
  error,
  onDismissError,
  onCancel,
}: SaveUploadProps) => {
  const colors = usePlannerColors();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string>();

  const pick = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  const loadDemoSave = async (name: string) => {
    const demo = demoSaves.find((entry) => entry.name === name);
    if (!demo) return;
    setLoadingDemo(true);
    setDemoError(undefined);
    try {
      const response = await fetch(demo.url);
      if (!response.ok) throw new Error(`Demo save request failed (${response.status}).`);
      const blob = await response.blob();
      onFile(new File([blob], demo.name, { type: 'application/octet-stream' }));
    } catch (cause) {
      setDemoError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingDemo(false);
    }
  };

  const percent = Math.round(Math.max(0, Math.min(1, progress?.progress ?? 0)) * 100);

  return (
    <Box component="section" sx={{ mb: 4 }} aria-labelledby="planner-upload-heading">
      {error && (
        <Alert
          severity="error"
          onClose={onDismissError}
          sx={{ mb: 2, textAlign: 'left' }}
        >
          <AlertTitle id="planner-upload-error">{error.message}</AlertTitle>
          {error.detail && (
            <Box component="details">
              <summary>Technical details</summary>
              <Box
                component="code"
                sx={{ display: 'block', mt: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {error.detail}
              </Box>
            </Box>
          )}
        </Alert>
      )}

      <Box
        className={`planner-upload${dragging ? ' is-dragging' : ''}`}
        sx={{
          p: { xs: 3, md: 4 },
          border: '2px dashed',
          borderColor: dragging ? 'primary.main' : colors.borderSoft,
          borderRadius: 1.5,
          bgcolor: dragging ? colors.surfaceHighlight : colors.surfaceMuted,
          color: colors.textSecondary,
          textAlign: 'center',
          transition: 'border-color 0.15s ease, background-color 0.15s ease',
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) pick(event.dataTransfer.files);
        }}
      >
        <Typography id="planner-upload-heading" variant="h5" component="h2" gutterBottom sx={{ fontSize: '1.5rem' }}>
          Import a Satisfactory save
        </Typography>
        <Typography sx={{ maxWidth: '40rem', mx: 'auto', mt: 1.5, mb: 2.5, color: colors.textSecondary }}>
          Drop a <code>.sav</code> file here, or choose one below. The save is parsed in a Web
          Worker on this device and never uploaded.
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'center' }}>
          <Button
            component="label"
            variant="contained"
            color="primary"
            aria-disabled={busy}
            sx={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : undefined }}
          >
            Choose save
            <input
              id="planner-save-input"
              ref={inputRef}
              hidden
              type="file"
              accept=".sav"
              onChange={(event) => {
                pick(event.target.files);
                if (inputRef.current) inputRef.current.value = '';
              }}
              disabled={busy}
            />
          </Button>
          {busy && onCancel && (
            <Button variant="outlined" size="small" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {demoSaves.length > 0 && (
            <>
              <TextField
                select
                size="small"
                label="Load demo save"
                value=""
                onChange={(event) => void loadDemoSave(event.target.value)}
                disabled={busy || loadingDemo}
                sx={{ minWidth: 190 }}
              >
                <MenuItem value="" disabled>
                  Try a demo save…
                </MenuItem>
                {demoSaves.map((demo) => (
                  <MenuItem key={demo.name} value={demo.name}>
                    {demo.name.replace(/\.sav$/i, '')}
                  </MenuItem>
                ))}
              </TextField>
              {loadingDemo && <CircularProgress size={18} aria-label="Loading demo save" />}
            </>
          )}
        </Box>
        {demoError && (
          <Typography color="error" variant="caption" sx={{ display: 'block', mt: 1 }}>
            {demoError}
          </Typography>
        )}
        <Typography sx={{ mt: 2, color: colors.textMuted, fontSize: '0.85rem' }}>
          Saves up to 50 MB. Unknown or modded buildings are imported and marked unmodeled.
        </Typography>
        {busy && (
          <Box sx={{ maxWidth: '34rem', mx: 'auto', mt: 2.5 }} aria-live="polite">
            <LinearProgress variant="determinate" value={percent} aria-label="Save parse progress" />
            <Typography component="p" sx={{ mt: 1, color: colors.textSecondary, fontSize: '0.85rem' }}>
              <Box component="span" sx={{ fontWeight: 600 }}>{percent}%</Box>
              {' · '}
              <Box component="span">
                {progress ? progressLabel(progress) : 'Starting…'}
              </Box>
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};
