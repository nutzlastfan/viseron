import { DocumentDownload, VideoAdd } from "@carbon/icons-react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { Dayjs } from "dayjs";
import { useState } from "react";

import { CameraPickerDialog } from "components/camera/CameraPickerDialog";
import { useFilteredCameras } from "components/camera/useCameraStore";
import {
  useExportDestination,
  useExportDestinationOptions,
} from "hooks/UseExportDestination";
import { useExportTimespan } from "hooks/UseExportTimespan";
import { getDisplayDateTimeFormat, is12HourFormat } from "lib/helpers/dates";

type ExportDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export function ExportDialog({ open, setOpen }: ExportDialogProps) {
  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [endDate, setEndDate] = useState<Dayjs | null>(null);
  const [cameraDialogOpen, setCameraDialogOpen] = useState(false);
  const [exportDestination, setExportDestination] = useExportDestination();
  const { options: exportDestinations } = useExportDestinationOptions();

  const filteredCameras = useFilteredCameras();
  const exportTimespan = useExportTimespan();
  const selectedCameraIdentifiers = Object.keys(filteredCameras);
  const selectedCameraNames = selectedCameraIdentifiers.map(
    (identifier) => filteredCameras[identifier].name || identifier,
  );
  const selectedCameraLabel =
    selectedCameraNames.length > 0
      ? selectedCameraNames.slice(0, 3).join(", ") +
        (selectedCameraNames.length > 3
          ? ` +${selectedCameraNames.length - 3}`
          : "")
      : "No cameras selected";

  const handleClose = () => {
    setOpen(false);
  };

  const handleStartDate = (newValue: Dayjs | null) => {
    setStartDate(newValue);
  };

  const handleEndDate = (newValue: Dayjs | null) => {
    setEndDate(newValue);
  };

  const handleExport = () => {
    if (!startDate || !endDate) return;
    exportTimespan(
      selectedCameraIdentifiers,
      startDate.unix(),
      endDate.unix(),
      exportDestination,
    );
    handleClose();
  };

  const isExportDisabled =
    !startDate ||
    !endDate ||
    endDate.isBefore(startDate) ||
    selectedCameraIdentifiers.length === 0;
  return (
    <>
      <CameraPickerDialog
        open={cameraDialogOpen}
        setOpen={setCameraDialogOpen}
      />
      <Dialog
        fullWidth
        maxWidth="xs"
        open={open}
        onClose={handleClose}
        scroll="paper"
        sx={{
          "& .MuiDialog-container": {
            alignItems: "flex-start",
            paddingTop: "10vh",
          },
        }}
      >
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={1}>
            <DocumentDownload size={24} />
            <Typography variant="h6">Download Recording</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Stack spacing={1}>
              <Button
                startIcon={<VideoAdd size={20} />}
                onClick={() => setCameraDialogOpen(true)}
                variant="outlined"
              >
                Select Cameras
              </Button>
              <Typography color="text.secondary" variant="body2">
                {selectedCameraLabel}
              </Typography>
            </Stack>
            <DateTimePicker
              label="Start Date & Time"
              views={["year", "month", "day", "hours", "minutes", "seconds"]}
              value={startDate}
              onAccept={handleStartDate}
              onChange={handleStartDate}
              closeOnSelect={false}
              ampm={is12HourFormat()}
              format={getDisplayDateTimeFormat()}
            />
            <DateTimePicker
              label="End Date & Time"
              views={["year", "month", "day", "hours", "minutes", "seconds"]}
              value={endDate}
              onAccept={handleEndDate}
              onChange={handleEndDate}
              closeOnSelect={false}
              ampm={is12HourFormat()}
              minDateTime={startDate || undefined}
              format={getDisplayDateTimeFormat()}
            />
            <FormControl fullWidth>
              <InputLabel id="export-destination-label">Destination</InputLabel>
              <Select
                labelId="export-destination-label"
                label="Destination"
                value={exportDestination}
                onChange={(event) =>
                  setExportDestination(event.target.value as typeof exportDestination)
                }
              >
                {exportDestinations.map((destination) => (
                  <MenuItem key={destination.value} value={destination.value}>
                    {destination.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleExport}
            disabled={isExportDisabled}
            variant="contained"
          >
            Export
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
