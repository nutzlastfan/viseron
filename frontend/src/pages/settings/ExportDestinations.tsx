import { Add, Save, TrashCan } from "@carbon/icons-react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { ErrorMessage } from "components/error/ErrorMessage";
import { Loading } from "components/loading/Loading";
import { useTitle } from "hooks/UseTitle";
import {
  useExportDestinations,
  useSaveExportDestinations,
} from "lib/api/exportDestinations";
import type { ExportDestinationConfig } from "lib/types";

const emptyDestination = (): ExportDestinationConfig => ({
  id: "",
  name: "",
  path: "",
  enabled: true,
});

type DestinationDraft = ExportDestinationConfig & {
  rowKey: string;
};

let destinationRowCounter = 0;

const rowKey = () => {
  destinationRowCounter += 1;
  return `destination-${Date.now()}-${destinationRowCounter}`;
};

const destinationDraft = (
  destination: ExportDestinationConfig,
): DestinationDraft => ({
  ...destination,
  rowKey: rowKey(),
});

const stripDraftKeys = (
  destinations: DestinationDraft[],
): ExportDestinationConfig[] =>
  destinations.map(({ rowKey: _rowKey, ...destination }) => destination);

function ExportDestinationsEditor({
  initialDestinations,
}: {
  initialDestinations: ExportDestinationConfig[];
}) {
  const saveDestinations = useSaveExportDestinations();
  const [destinations, setDestinations] = useState<DestinationDraft[]>(() =>
    initialDestinations.map(destinationDraft),
  );

  const updateDestination = (
    index: number,
    field: keyof DestinationDraft,
    value: string | boolean,
  ) => {
    setDestinations((current) =>
      current.map((destination, destinationIndex) =>
        destinationIndex === index
          ? { ...destination, [field]: value }
          : destination,
      ),
    );
  };

  const removeDestination = (index: number) => {
    setDestinations((current) =>
      current.filter((_, destinationIndex) => destinationIndex !== index),
    );
  };

  const addDestination = () => {
    setDestinations((current) => [
      ...current,
      destinationDraft(emptyDestination()),
    ]);
  };

  const hasInvalidDestination = destinations.some(
    (destination) =>
      !destination.id.trim() ||
      !destination.name.trim() ||
      !destination.path.trim(),
  );

  const duplicateIds =
    new Set(destinations.map((destination) => destination.id.trim())).size !==
    destinations.length;

  return (
    <Container maxWidth={false} sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Typography variant="h5">Export Destinations</Typography>
          <Stack direction="row" spacing={1}>
            <Button startIcon={<Add />} onClick={addDestination}>
              Add
            </Button>
            <Button
              variant="contained"
              startIcon={<Save />}
              disabled={
                saveDestinations.isPending ||
                hasInvalidDestination ||
                duplicateIds
              }
              onClick={() =>
                saveDestinations.mutate(stripDraftKeys(destinations))
              }
            >
              Save
            </Button>
          </Stack>
        </Stack>
        <Alert severity="info">
          Browser download is always available. Server destinations must point to
          a path that is writable inside the Viseron container.
        </Alert>
        {duplicateIds ? (
          <Alert severity="error">Destination IDs must be unique.</Alert>
        ) : null}
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 170 }}>ID</TableCell>
                <TableCell sx={{ width: 220 }}>Name</TableCell>
                <TableCell>Path</TableCell>
                <TableCell align="center" sx={{ width: 90 }}>
                  Enabled
                </TableCell>
                <TableCell align="right" sx={{ width: 72 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {destinations.map((destination, index) => (
                <TableRow key={destination.rowKey}>
                  <TableCell>
                    <TextField
                      value={destination.id}
                      onChange={(event) =>
                        updateDestination(index, "id", event.target.value)
                      }
                      size="small"
                      fullWidth
                      error={!destination.id.trim()}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={destination.name}
                      onChange={(event) =>
                        updateDestination(index, "name", event.target.value)
                      }
                      size="small"
                      fullWidth
                      error={!destination.name.trim()}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      value={destination.path}
                      onChange={(event) =>
                        updateDestination(index, "path", event.target.value)
                      }
                      size="small"
                      fullWidth
                      error={!destination.path.trim()}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox
                      checked={destination.enabled}
                      onChange={(event) =>
                        updateDestination(index, "enabled", event.target.checked)
                      }
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Delete">
                      <IconButton
                        color="error"
                        onClick={() => removeDestination(index)}
                      >
                        <TrashCan size={20} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </Container>
  );
}

export default function ExportDestinations() {
  useTitle("Export Destinations");
  const destinationsQuery = useExportDestinations();

  if (destinationsQuery.isPending) {
    return <Loading text="Loading export destinations" />;
  }

  if (destinationsQuery.isError) {
    return (
      <ErrorMessage
        text="Error loading export destinations"
        subtext={destinationsQuery.error.message}
      />
    );
  }

  return (
    <ExportDestinationsEditor
      key={JSON.stringify(destinationsQuery.data.destinations)}
      initialDestinations={destinationsQuery.data.destinations}
    />
  );
}
