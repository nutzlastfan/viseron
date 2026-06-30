import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { type Dayjs } from "dayjs";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Loading } from "components/loading/Loading";
import { useAuthContext } from "context/AuthContext";
import { useTitle } from "hooks/UseTitle";
import { useCamerasAll } from "lib/api/cameras";
import {
  useAddFeederAnimal,
  useAddFeederLock,
  useDeleteFeederAnimal,
  useDeleteFeederLock,
  useFeeders,
  useSetFeederSettings,
} from "lib/api/feeders";
import { getDayjs } from "lib/helpers/dates";
import * as types from "lib/types";

const DAYS = ["All", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DraftLock = {
  day: number;
  from: Dayjs | null;
  to: Dayjs | null;
};

const emptyLock = (): DraftLock => ({
  day: 0,
  from: getDayjs().hour(0).minute(0).second(0),
  to: getDayjs().hour(23).minute(59).second(0),
});

function TabPanel({
  children,
  index,
  value,
}: {
  children: ReactNode;
  index: number;
  value: number;
}) {
  if (value !== index) {
    return null;
  }
  return <Box sx={{ pt: 1.5 }}>{children}</Box>;
}

function readableState(value: boolean, enabled: string, disabled: string) {
  return value ? enabled : disabled;
}

function FeederCard({
  feeder,
  canWrite,
}: {
  feeder: types.Feeder;
  canWrite: boolean;
}) {
  const [tagid, setTagid] = useState("");
  const [tab, setTab] = useState(0);
  const [lock, setLock] = useState<DraftLock>(emptyLock);
  const setSettings = useSetFeederSettings();
  const addAnimal = useAddFeederAnimal();
  const deleteAnimal = useDeleteFeederAnimal();
  const addLock = useAddFeederLock();
  const deleteLock = useDeleteFeederLock();
  const disabled = !canWrite || !feeder.available || feeder.read_only;
  const mode = Boolean(feeder.settings.mode);
  const door = Boolean(feeder.settings.door);
  const lastEvent = feeder.protocol[0];

  const updateSettings = (settings: types.FeederSettings) => {
    setSettings.mutate({ feederId: feeder.id, settings });
  };

  const submitAnimal = () => {
    const nextTag = tagid.trim();
    if (!nextTag) {
      return;
    }
    addAnimal.mutate({ feederId: feeder.id, tagid: nextTag });
    setTagid("");
  };

  const submitLock = () => {
    if (!lock.from || !lock.to) {
      return;
    }
    addLock.mutate({
      feederId: feeder.id,
      day: lock.day,
      from_h: lock.from.hour(),
      from_m: lock.from.minute(),
      to_h: lock.to.hour(),
      to_m: lock.to.minute(),
    });
    setLock(emptyLock());
  };

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack
            alignItems="flex-start"
            direction="row"
            justifyContent="space-between"
            spacing={1}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap variant="h6">
                {feeder.name}
              </Typography>
              <Typography color="text.secondary" noWrap variant="body2">
                {feeder.host}:{feeder.port}
              </Typography>
            </Box>
            <Chip
              color={feeder.available ? "success" : "error"}
              label={feeder.available ? "Online" : "Offline"}
              size="small"
            />
          </Stack>

          {feeder.error && (
            <Typography color="error" variant="body2">
              {feeder.error}
            </Typography>
          )}

          <Stack direction="row" flexWrap="wrap" gap={1}>
            <Chip
              label={`Mode: ${readableState(mode, "Auto", "Manual")}`}
              size="small"
              variant="outlined"
            />
            <Chip
              label={`Door: ${readableState(door, "Open", "Locked")}`}
              size="small"
              variant="outlined"
            />
            <Chip
              label={`${feeder.animals.length} Animals`}
              size="small"
              variant="outlined"
            />
            <Chip
              label={`${feeder.locks.length} Locks`}
              size="small"
              variant="outlined"
            />
            {feeder.read_only && (
              <Chip color="warning" label="Read only" size="small" />
            )}
          </Stack>

          {lastEvent && (
            <Typography color="text.secondary" noWrap variant="body2">
              {lastEvent.timestamp} · {lastEvent.tagid} ·{" "}
              {lastEvent.action_label}
            </Typography>
          )}

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Stack alignItems="center" direction="row" spacing={1}>
              <Typography variant="body2">Manual</Typography>
              <Switch
                checked={mode}
                disabled={disabled || setSettings.isPending}
                size="small"
                onChange={(event) =>
                  updateSettings({ mode: event.target.checked, door })
                }
              />
              <Typography variant="body2">Auto</Typography>
            </Stack>
            <Stack alignItems="center" direction="row" spacing={1}>
              <Typography variant="body2">Locked</Typography>
              <Switch
                checked={door}
                disabled={disabled || setSettings.isPending}
                size="small"
                onChange={(event) =>
                  updateSettings({ mode, door: event.target.checked })
                }
              />
              <Typography variant="body2">Open</Typography>
            </Stack>
          </Stack>

          <Tabs
            value={tab}
            variant="fullWidth"
            onChange={(_event, nextTab: number) => setTab(nextTab)}
          >
            <Tab label="Animals" />
            <Tab label="Locks" />
            <Tab label="Protocol" />
          </Tabs>

          <TabPanel value={tab} index={0}>
            <Stack direction="row" spacing={1}>
              <TextField
                disabled={disabled}
                fullWidth
                label="RFID"
                size="small"
                value={tagid}
                onChange={(event) => setTagid(event.target.value)}
              />
              <Tooltip title="Add animal">
                <span>
                  <IconButton
                    color="primary"
                    disabled={disabled || addAnimal.isPending || !tagid.trim()}
                    onClick={submitAnimal}
                  >
                    <AddIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
            <Table size="small">
              <TableBody>
                {feeder.animals.map((animal) => (
                  <TableRow key={animal.id}>
                    <TableCell>{animal.tagid}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Delete animal">
                        <span>
                          <IconButton
                            disabled={disabled || deleteAnimal.isPending}
                            size="small"
                            onClick={() =>
                              deleteAnimal.mutate({
                                feederId: feeder.id,
                                animalId: animal.id,
                              })
                            }
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabPanel>

          <TabPanel value={tab} index={1}>
            <Grid container spacing={1}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Day</InputLabel>
                  <Select
                    disabled={disabled}
                    label="Day"
                    value={lock.day}
                    onChange={(event) =>
                      setLock({ ...lock, day: Number(event.target.value) })
                    }
                  >
                    {DAYS.map((day, index) => (
                      <MenuItem key={day} value={index}>
                        {day}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3.5 }}>
                <TimePicker
                  ampm={false}
                  label="From"
                  disabled={disabled}
                  value={lock.from}
                  views={["hours", "minutes"]}
                  onChange={(value) => setLock({ ...lock, from: value })}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      inputProps: { readOnly: true },
                      size: "small",
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 3.5 }}>
                <TimePicker
                  ampm={false}
                  label="To"
                  disabled={disabled}
                  value={lock.to}
                  views={["hours", "minutes"]}
                  onChange={(value) => setLock({ ...lock, to: value })}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      inputProps: { readOnly: true },
                      size: "small",
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 1 }}>
                <Tooltip title="Add lock">
                  <span>
                    <IconButton
                      color="primary"
                      disabled={disabled || addLock.isPending}
                      onClick={submitLock}
                    >
                      <AddIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Grid>
            </Grid>
            <Table size="small">
              <TableBody>
                {feeder.locks.map((feederLock) => (
                  <TableRow key={feederLock.id}>
                    <TableCell>{DAYS[feederLock.day]}</TableCell>
                    <TableCell>
                      {feederLock.from_time} - {feederLock.to_time}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Delete lock">
                        <span>
                          <IconButton
                            disabled={disabled || deleteLock.isPending}
                            size="small"
                            onClick={() =>
                              deleteLock.mutate({
                                feederId: feeder.id,
                                lockId: feederLock.id,
                              })
                            }
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabPanel>

          <TabPanel value={tab} index={2}>
            <Box sx={{ maxHeight: 300, overflow: "auto" }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>RFID</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell align="right">s</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {feeder.protocol.map((entry) => (
                    <TableRow
                      key={`${entry.timestamp}-${entry.tagid}-${entry.action}-${entry.duration}`}
                    >
                      <TableCell>{entry.timestamp}</TableCell>
                      <TableCell>{entry.tagid}</TableCell>
                      <TableCell>{entry.action_label}</TableCell>
                      <TableCell align="right">{entry.duration}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </TabPanel>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Feeders() {
  useTitle("Feeders");
  const { auth, user } = useAuthContext();
  const feeders = useFeeders();
  const cameras = useCamerasAll();
  const [readOnlyNoticeDismissed, setReadOnlyNoticeDismissed] = useState(false);
  const canWrite =
    !auth.enabled || user?.role === "admin" || user?.role === "write";

  useEffect(() => {
    if (!feeders.data?.read_only) {
      return undefined;
    }

    const timeout = window.setTimeout(
      () => setReadOnlyNoticeDismissed(true),
      8000,
    );
    return () => window.clearTimeout(timeout);
  }, [feeders.data?.read_only]);

  const feedersById = useMemo(() => {
    const nextFeeders = new Map<string, types.Feeder>();
    feeders.data?.feeders.forEach((feeder) =>
      nextFeeders.set(feeder.id, feeder),
    );
    return nextFeeders;
  }, [feeders.data]);

  if (feeders.isPending || cameras.isLoading) {
    return <Loading text="Loading Feeders" />;
  }

  return (
    <Container maxWidth={false} sx={{ px: { xs: 1, md: 2 }, py: 1 }}>
      <Stack spacing={2}>
        {feeders.data?.read_only && !readOnlyNoticeDismissed && (
          <Alert severity="warning">
            Futterautomaten sind aktuell nur lesend eingebunden. Steuerbefehle
            werden erst nach Freigabe aktiviert.
          </Alert>
        )}
        {feeders.data?.rooms.map((room) => (
          <Box key={room.id}>
            <Stack
              alignItems={{ xs: "flex-start", md: "center" }}
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={1}
              sx={{ mb: 1.5 }}
            >
              <Typography variant="h5">{room.name}</Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {room.cameras.map((cameraId) => {
                  const camera = cameras.combinedData[cameraId];
                  return (
                    <Chip
                      key={cameraId}
                      label={camera ? camera.name : cameraId}
                      size="small"
                      variant="outlined"
                    />
                  );
                })}
              </Stack>
            </Stack>
            <Grid container spacing={1.5}>
              {room.feeders.map((feederId) => {
                const feeder = feedersById.get(feederId);
                if (!feeder) {
                  return null;
                }
                return (
                  <Grid key={feederId} size={{ xs: 12, md: 6, xl: 4 }}>
                    <FeederCard feeder={feeder} canWrite={canWrite} />
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        ))}
      </Stack>
    </Container>
  );
}

export default Feeders;
