import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import type { NormalizedSave, ParseProgress, PlannerError } from './domain/types';
import { parseSaveFile } from './api/parseSave.client';
import { toPlannerError } from './api/plannerError';
import { plannerRepository, type CheckpointRepository } from './storage/db';
import { PlannerSummary } from './components/PlannerSummary';
import { SaveUpload } from './components/SaveUpload';
import { LineList } from './components/LineList';
import { FindingsPanel } from './components/FindingsPanel';
import { BuildingDetails } from './components/BuildingDetails';
import { CheckpointList } from './components/CheckpointList';
import { PlannerInfo } from './components/PlannerInfo';
import { analyzeModel } from './domain/analyzeModel';
import { getLineStats } from './domain/lineStats';
import { usePlannerColors } from './theme';
import { usePlannerView } from './plannerView';
import satisfactoryBanner from './assets/satisfactory_banner.jpg';

const LineGraph = lazy(() =>
  import('./components/LineGraph').then((module) => ({ default: module.LineGraph })),
);

type TabKey = 'overview' | 'lines' | 'findings' | 'checkpoints';

export interface PlannerPageProps {
  parseSave?: typeof parseSaveFile;
  repository?: CheckpointRepository;
}

export const PlannerPage = ({
  parseSave = parseSaveFile,
  repository: repositoryProp,
}: PlannerPageProps) => {
  const repository = repositoryProp ?? plannerRepository;
  const [model, setModel] = useState<NormalizedSave>();
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress>();
  const [error, setError] = useState<PlannerError>();
  const [tab, setTab] = useState<TabKey>('overview');
  const [selectedLineId, setSelectedLineId] = useState<string>();
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importStartedRef = useRef(false);
  const colors = usePlannerColors();
  const { view } = usePlannerView();
  const analysis = useMemo(() => (model ? analyzeModel(model) : undefined), [model]);
  const lineStats = analysis?.lineStats;
  const displayLines = analysis?.supplyLines.filter((line) => line.buildingIds.length > 1) ?? [];

  const buildingsById = useMemo(
    () => new Map((model?.buildings ?? []).map((building) => [building.id, building])),
    [model],
  );

  const selectedLine = analysis?.supplyLines.find((line) => line.id === selectedLineId);
  const selectedBuilding = selectedBuildingId
    ? buildingsById.get(selectedBuildingId)
    : undefined;
  const selectedSupplyNode = selectedBuildingId
    ? analysis?.supplyLines
        .flatMap((line) => Object.values(line.nodes))
        .find((node) => node.id === selectedBuildingId)
    : undefined;

  const loadModel = (next: NormalizedSave, file: File | null) => {
    setModel(next);
    setCurrentFile(file);
    setSelectedLineId(getLineStats(next).activeLines[0]?.id);
    setSelectedBuildingId(undefined);
    setTab('overview');
    void repository.saveSession(next).catch(() => undefined);
  };

  useEffect(() => {
    let active = true;
    void repository
      .loadSession()
      .then((saved) => {
        if (!active || importStartedRef.current || !saved) return;
        setModel(saved);
        setCurrentFile(null);
        setSelectedLineId(getLineStats(saved).activeLines[0]?.id);
        setSelectedBuildingId(undefined);
        setTab('overview');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repository]);

  const handleFile = async (file: File) => {
    importStartedRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(undefined);
    setProgress({ phase: 'reading', progress: 0 });
    setModel(undefined);
    setSelectedBuildingId(undefined);

    try {
      const next = await parseSave(file, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      loadModel(next, file);
    } catch (cause) {
      const mapped = toPlannerError(cause);
      if (mapped.code !== 'ABORTED') setError(mapped);
    } finally {
      if (abortRef.current === controller) {
        setBusy(false);
        setProgress(undefined);
        abortRef.current = undefined;
      }
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const restore = (next: NormalizedSave) => {
    loadModel(next, null);
  };

  const unload = () => {
    abortRef.current?.abort();
    setModel(undefined);
    setCurrentFile(null);
    setSelectedLineId(undefined);
    setSelectedBuildingId(undefined);
    setTab('overview');
    setError(undefined);
    void repository.clearSession().catch(() => undefined);
  };

  const selectLine = (lineId: string) => {
    setSelectedLineId(lineId);
    setSelectedBuildingId(undefined);
  };

  return (
    <Container maxWidth={false} sx={{ maxWidth: 1440, pt: 3, pb: 4, textAlign: 'left' }}>
      <Box
        sx={{
          display: 'grid',
          width: '100%',
          height: { xs: 140, sm: 180, md: 240, lg: 300 },
          mb: 3,
          overflow: 'hidden',
          borderRadius: '10px',
        }}
      >
        <Box
          component="img"
          src={satisfactoryBanner}
          alt="Satisfactory banner"
          sx={{
            minWidth: 0,
            minHeight: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'left top',
            display: 'block',
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h1" component="h1" sx={{ mb: 0.5, fontSize: { xs: '1.8rem', md: '2.5rem' } }}>
            {view === 'info' ? 'Planner info' : 'Factory Planner'}
          </Typography>
          <Typography variant="body2" sx={{ maxWidth: '60rem', color: colors.textOnBackgroundMuted, fontSize: '0.875rem' }}>
            {view === 'info'
              ? 'How the Satisfactory planner reads a save, what it estimates, and where it stops.'
              : 'Import a Satisfactory save to inspect recipe supply lines, estimated bottlenecks and power. Parsing happens locally in a Web Worker; save bytes never leave this browser.'}
          </Typography>
        </Box>
        {view === 'planner' && model && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sav"
              hidden
              aria-label="Import another save"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = '';
              }}
            />
            <Button
              variant="outlined"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Import another save
            </Button>
            <Button variant="outlined" color="error" onClick={unload}>
              Unload current save
            </Button>
          </Box>
        )}
      </Box>

      {view === 'info' ? (
        <PlannerInfo />
      ) : !model ? (
        <SaveUpload
          onFile={(file) => void handleFile(file)}
          busy={busy}
          progress={progress}
          error={error}
          onDismissError={error ? () => setError(undefined) : undefined}
          onCancel={busy ? cancel : undefined}
        />
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={(_, value: TabKey) => setTab(value)}
            variant="scrollable"
            allowScrollButtonsMobile
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              '& .MuiTab-root': { color: colors.textOnBackgroundMuted },
              '& .Mui-selected': { color: 'primary.main' },
            }}
          >
            <Tab value="overview" label="Overview" />
            <Tab value="lines" label={`Lines (${displayLines.length})`} />
            <Tab value="findings" label={`Findings (${analysis?.findings.length ?? 0})`} />
            <Tab value="checkpoints" label="Checkpoints" />
          </Tabs>

          <Box sx={{ pt: 3 }}>
            {tab === 'overview' && (
              <>
                <PlannerSummary model={model} analysis={analysis!} />
                {(analysis?.findings.length ?? 0) > 0 && (
                  <Card sx={{ mt: 2 }}>
                    <CardContent>
                      <Box className="planner-section-head">
                        <Typography variant="h5" component="h2">Top estimated problems</Typography>
                        <Button variant="text" size="small" onClick={() => setTab('findings')}>
                          View all {analysis?.findings.length ?? 0}
                        </Button>
                      </Box>
                      <FindingsPanel findings={analysis?.findings.slice(0, 5) ?? []} />
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {tab === 'lines' && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(300px, 1fr) minmax(0, 2fr)' },
                  gap: 2,
                }}
              >
                <Card>
                  <CardContent>
                    <Typography variant="h5" component="h2">Supply lines</Typography>
                    <Typography variant="body2" sx={{ maxWidth: '60rem', color: colors.textOnBackgroundMuted, fontSize: '0.875rem' }}>
                      Lines are weakly connected components of recipe item flows. Single
                      unconnected buildings are hidden.
                    </Typography>
                    <Typography variant="body2" sx={{ color: colors.textOnBackgroundMuted, fontSize: '0.875rem', mb: 1 }}>
                      {lineStats?.buildingsInLines ?? 0} / {lineStats?.totalCandidates ?? 0}{' '}
                      buildings in lines
                    </Typography>
                    <LineList
                      lines={displayLines}
                      findings={analysis?.findings ?? []}
                      selectedLineId={selectedLineId}
                      onSelect={selectLine}
                    />
                  </CardContent>
                </Card>
                <Box>
                  <Suspense
                    fallback={
                      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                        <CircularProgress aria-label="Loading graph" />
                      </Box>
                    }
                  >
                    <LineGraph
                      line={selectedLine}
                      findings={analysis?.findings ?? []}
                      selectedBuildingId={selectedBuildingId}
                      onSelectBuilding={setSelectedBuildingId}
                    />
                  </Suspense>
                  <Box sx={{ mt: 2 }}>
                    <BuildingDetails
                      building={selectedBuilding}
                      supplyNode={selectedSupplyNode}
                      onClose={() => setSelectedBuildingId(undefined)}
                    />
                  </Box>
                </Box>
              </Box>
            )}

            {tab === 'findings' && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
                  gap: 2,
                }}
              >
                <Card>
                  <CardContent>
                    <Typography variant="h5" component="h2">Estimated findings</Typography>
                    <Typography variant="body2" sx={{ maxWidth: '60rem', color: colors.textOnBackgroundMuted, fontSize: '0.875rem' }}>
                      Every finding carries its numbers. Findings are static estimates, not
                      measured throughput.
                    </Typography>
                    <FindingsPanel
                      findings={analysis?.findings ?? []}
                      onSelectBuilding={setSelectedBuildingId}
                    />
                  </CardContent>
                </Card>
                <BuildingDetails
                  building={selectedBuilding}
                  supplyNode={selectedSupplyNode}
                  onClose={() => setSelectedBuildingId(undefined)}
                />
              </Box>
            )}

            {tab === 'checkpoints' && (
              <CheckpointList
                currentModel={model}
                currentFile={currentFile}
                onRestore={restore}
                repository={repository}
              />
            )}
          </Box>
        </>
      )}
    </Container>
  );
};
