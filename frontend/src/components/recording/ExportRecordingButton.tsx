import { Download } from "@carbon/icons-react";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useState } from "react";

import {
  useExportDestination,
  useExportDestinationOptions,
} from "hooks/UseExportDestination";
import { useExportRecording } from "hooks/UseExportRecording";
import type { ExportDestination } from "lib/types";

type ExportRecordingButtonProps = {
  cameraIdentifier: string;
  disabled?: boolean;
  recordingId?: number;
  tooltip?: string;
};

export default function ExportRecordingButton({
  cameraIdentifier,
  disabled = false,
  recordingId,
  tooltip = "Export recording",
}: ExportRecordingButtonProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedDestination, setSelectedDestination] = useExportDestination();
  const { options } = useExportDestinationOptions();
  const exportRecording = useExportRecording();

  const handleExport = (destination: ExportDestination) => {
    setSelectedDestination(destination);
    setAnchorEl(null);
    if (recordingId !== undefined) {
      exportRecording(cameraIdentifier, recordingId, destination);
    }
  };

  return (
    <>
      <Tooltip title={tooltip}>
        <span>
          <IconButton
            disabled={disabled || recordingId === undefined}
            onClick={(event) => setAnchorEl(event.currentTarget)}
          >
            <Download size={20} />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={selectedDestination === option.value}
            onClick={() => handleExport(option.value)}
          >
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
