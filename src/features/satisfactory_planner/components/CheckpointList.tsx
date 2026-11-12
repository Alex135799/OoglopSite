import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CheckpointRecord, ModelDiff, NormalizedSave } from '../domain/types';
import { diffCheckpoints } from '../domain/diffModels';
import {
  plannerRepository,
  type CheckpointRepository,
  type StorageUsage,
} from '../storage/db';
import { formatNumber, shortDate } from '../format';
import { usePlannerColors } from '../theme';
import { DiffView } from './DiffView';

export interface CheckpointListProps {
  currentModel?: NormalizedSave;
  currentFile?: File | null;
  onRestore: (model: NormalizedSave) => void;
  repository?: CheckpointRepository;
}

const downloadJson = (fileName: string, json: string) => {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const CheckpointList = ({
  currentModel,
  currentFile,
  onRestore,
  repository = plannerRepository,
}: CheckpointListProps) => {
  const colors = usePlannerColors();
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [usage, setUsage] = useState<StorageUsage>();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [selectedA, setSelectedA] = useState('');
  const [selectedB, setSelectedB] = useState('');
  const [diff, setDiff] = useState<ModelDiff>();
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [records, storage] = await Promise.all([
      repository.listCheckpoints(),
      repository.getUsage(),
    ]);
    setCheckpoints(records);
    setUsage(storage);
    return records;
  }, [repository]);

  useEffect(() => {
    void refresh().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [refresh]);

  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      await action();
      if (success) setInfo(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!currentModel) return;
    void run(async () => {
      await repository.saveCheckpoint({
        model: currentModel,
        label,
        ...(currentFile ? { file: currentFile } : {}),
      });
      setLabel('');
      await refresh();
    }, 'Checkpoint saved.');
  };

  const compare = () => {
    if (!selectedA || !selectedB) return;
    void run(async () => {
      const [before, after] = await Promise.all([
        repository.getCheckpoint(selectedA),
        repository.getCheckpoint(selectedB),
      ]);
      if (!before || !after) throw new Error('One of the selected checkpoints no longer exists.');
      setDiff(diffCheckpoints(before, after));
    });
  };

  const exportOne = (id: string, name: string) => {
    void run(async () => {
      const json = await repository.exportCheckpoint(id);
      downloadJson(`${name.replace(/[^\w.-]+/g, '-')}.planner.json`, json);
    });
  };

  const remove = (id: string) => {
    void run(async () => {
      await repository.deleteCheckpoint(id);
      if (selectedA === id) setSelectedA('');
      if (selectedB === id) setSelectedB('');
      setDiff(undefined);
      await refresh();
    }, 'Checkpoint deleted.');
  };

  const removeAll = () => {
    if (!window.confirm('Delete every planner checkpoint stored in this browser?')) return;
    void run(async () => {
      await repository.deleteAll();
      setSelectedA('');
      setSelectedB('');
      setDiff(undefined);
      await refresh();
    }, 'All checkpoints deleted.');
  };

  const importOne = async (file: File) => {
    setBusy(true);
    setError(undefined);
    setInfo(undefined);
    try {
      const text = await file.text();
      await repository.importCheckpoint(text);
      await refresh();
      setInfo('Checkpoint imported.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectOptions = checkpoints.map((checkpoint) => (
    <MenuItem key={checkpoint.id} value={checkpoint.id}>
      {checkpoint.label}
    </MenuItem>
  ));

  return (
    <Box component="section" sx={{ maxWidth: 1200 }} aria-labelledby="planner-checkpoints-heading">
      <Box className="planner-section-head">
        <Box>
          <Typography id="planner-checkpoints-heading" variant="h5" component="h2">
            Checkpoints
          </Typography>
          <Typography variant="body2" sx={{ color: colors.textOnBackgroundMuted }}>
            Named snapshots stay in this browser (IndexedDB). Save bytes are stored once per
            SHA-256 hash.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            onClick={() => importRef.current?.click()}
            disabled={busy}
          >
            Import JSON
          </Button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Import checkpoint JSON"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importOne(file);
              event.target.value = '';
            }}
          />
          <Button variant="outlined" color="error" size="small" onClick={removeAll} disabled={busy}>
            Delete all
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(undefined)} sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {info && (
        <Alert severity="success" onClose={() => setInfo(undefined)} sx={{ mb: 1 }}>
          {info}
        </Alert>
      )}
      {usage?.warning && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          Storage is getting full or you have more than 20 checkpoints. Delete old checkpoints or
          export them.
        </Alert>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) auto' },
              gap: 2,
              alignItems: 'end',
            }}
          >
            <TextField
              id="checkpoint-label"
              label="Checkpoint label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={
                currentModel
                  ? `Checkpoint for ${currentModel.source.fileName}`
                  : 'Import a save first'
              }
              disabled={!currentModel || busy}
              size="small"
            />
            <Button type="submit" variant="contained" color="primary" disabled={!currentModel || busy}>
              Save checkpoint
            </Button>
          </Box>
          <Typography variant="caption" className="planner-muted" sx={{ mt: 1, display: 'block' }}>
            {currentModel
              ? `Current model: ${currentModel.source.fileName} · ${formatNumber(
                  currentModel.buildings.length,
                )} production buildings`
              : 'Import a save to create the first checkpoint.'}
          </Typography>
          {usage && (
            <Typography variant="caption" className="planner-muted" sx={{ mt: 1, display: 'block' }}>
              {formatNumber(usage.checkpoints)} checkpoints ·{' '}
              {usage.bytes > 1024 * 1024
                ? `${(usage.bytes / (1024 * 1024)).toFixed(1)} MB`
                : `${(usage.bytes / 1024).toFixed(0)} KB`}{' '}
              of save data stored
              {usage.quota && usage.quota > 0
                ? ` · ${formatNumber(usage.percent * 100, 1)}% of browser quota used`
                : ''}
            </Typography>
          )}
        </CardContent>
      </Card>

      {checkpoints.length === 0 ? (
        <Box className="planner-empty" sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
          <Typography>No checkpoints yet.</Typography>
        </Box>
      ) : (
        <TableContainer
          sx={{
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Table size="small" sx={{ fontSize: '0.9rem' }}>
            <TableHead>
              <TableRow>
                <TableCell>Label</TableCell>
                <TableCell>Saved</TableCell>
                <TableCell>Source</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {checkpoints.map((checkpoint) => (
                <TableRow key={checkpoint.id}>
                  <TableCell>
                    <Typography component="span" sx={{ fontWeight: 600 }}>{checkpoint.label}</Typography>
                    <Typography variant="caption" className="planner-muted" component="div">
                      {formatNumber(checkpoint.model.buildings.length)} buildings ·{' '}
                      {formatNumber(checkpoint.model.findings.length)} findings
                    </Typography>
                  </TableCell>
                  <TableCell>{shortDate(checkpoint.createdAt)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={checkpoint.model.gameDataVersion} variant="outlined" />{' '}
                    <Typography component="code" variant="caption" className="planner-muted">
                      {checkpoint.saveHash.slice(0, 10)}…
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
                      <Button
                        variant={selectedA === checkpoint.id ? 'contained' : 'outlined'}
                        size="small"
                        onClick={() => setSelectedA(checkpoint.id)}
                      >
                        A
                      </Button>
                      <Button
                        variant={selectedB === checkpoint.id ? 'contained' : 'outlined'}
                        size="small"
                        onClick={() => setSelectedB(checkpoint.id)}
                      >
                        B
                      </Button>
                      <Button variant="outlined" size="small" onClick={() => onRestore(checkpoint.model)}>
                        Open
                      </Button>
                      <Button
                        variant="outlined"
                        color="secondary"
                        size="small"
                        onClick={() => exportOne(checkpoint.id, checkpoint.label)}
                        disabled={busy}
                      >
                        Export
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() => remove(checkpoint.id)}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {checkpoints.length > 1 && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="h6" component="h3">Compare checkpoints</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr auto' },
                gap: 2,
                alignItems: 'end',
              }}
            >
              <FormControl size="small">
                <InputLabel id="compare-a-label">Before (A)</InputLabel>
                <Select
                  labelId="compare-a-label"
                  id="compare-a"
                  value={selectedA}
                  label="Before (A)"
                  onChange={(event) => setSelectedA(event.target.value)}
                >
                  <MenuItem value="">Select a checkpoint</MenuItem>
                  {selectOptions}
                </Select>
              </FormControl>
              <FormControl size="small">
                <InputLabel id="compare-b-label">After (B)</InputLabel>
                <Select
                  labelId="compare-b-label"
                  id="compare-b"
                  value={selectedB}
                  label="After (B)"
                  onChange={(event) => setSelectedB(event.target.value)}
                >
                  <MenuItem value="">Select a checkpoint</MenuItem>
                  {selectOptions}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                onClick={compare}
                disabled={!selectedA || !selectedB || selectedA === selectedB || busy}
              >
                Compare
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {diff && <DiffView diff={diff} />}
    </Box>
  );
};
