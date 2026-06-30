import { Add, Video } from "@carbon/icons-react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import List from "@mui/material/List";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { AddCameraDialog } from "components/camera/AddCameraDialog";
import { CameraEditDialog } from "components/camera/CameraEditDialog";
import { Loading } from "components/loading/Loading";
import { useTitle } from "hooks/UseTitle";
import { useCamerasAll } from "lib/api/cameras";
import * as types from "lib/types";

function cameraSecondaryText(camera: types.Camera | types.FailedCamera) {
  return camera.status.detail
    ? `${camera.status.label}: ${camera.status.detail}`
    : camera.status.label;
}

function cameraAvatarColor(camera: types.Camera | types.FailedCamera) {
  if (camera.status.severity === "error") {
    return "error.main";
  }
  if (camera.status.severity === "warning") {
    return "warning.main";
  }
  if (camera.status.severity === "success") {
    return "success.main";
  }
  return "primary.main";
}

function CamerasSettings() {
  useTitle("Cameras");
  const [addCameraOpen, setAddCameraOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<
    types.Camera | types.FailedCamera | null
  >(null);
  const cameras = useCamerasAll();
  const cameraEntries = Object.values(cameras.combinedData);

  if (cameras.isLoading) {
    return <Loading text="Loading Cameras" />;
  }

  return (
    <Container maxWidth="md" sx={{ py: 2 }}>
      <Box
        sx={{
          alignItems: "center",
          display: "flex",
          gap: 2,
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Typography variant="h5">Cameras</Typography>
        <Button
          startIcon={<Add />}
          variant="contained"
          onClick={() => setAddCameraOpen(true)}
        >
          Add Camera
        </Button>
      </Box>

      <Paper variant="outlined">
        <List>
          {cameraEntries.length === 0 ? (
            <ListItemText
              sx={{ px: 2, py: 3 }}
              primary="No cameras configured"
              secondary="Add Camera"
            />
          ) : (
            cameraEntries.map((camera) => (
              <ListItemButton
                key={camera.identifier}
                onClick={() => setSelectedCamera(camera)}
                sx={{
                  alignItems: "center",
                  display: "flex",
                  px: 2,
                  py: 1,
                }}
              >
                <ListItemAvatar>
                  <Avatar
                    sx={{
                      bgcolor: cameraAvatarColor(camera),
                    }}
                  >
                    <Video size={22} />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={camera.name}
                  secondary={cameraSecondaryText(camera)}
                />
              </ListItemButton>
            ))
          )}
        </List>
      </Paper>
      <AddCameraDialog
        open={addCameraOpen}
        onClose={() => setAddCameraOpen(false)}
      />
      {selectedCamera && (
        <CameraEditDialog
          camera={selectedCamera}
          onClose={() => setSelectedCamera(null)}
        />
      )}
    </Container>
  );
}

export default CamerasSettings;
