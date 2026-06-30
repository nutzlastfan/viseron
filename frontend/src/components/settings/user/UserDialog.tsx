import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  SelectChangeEvent,
  TextField,
} from "@mui/material";
import { useState } from "react";

import ChangePasswordDialog from "components/settings/user/ChangePasswordDialog";
import { useAuthContext } from "context/AuthContext";
import { useAuthDelete, useAuthUpdateUser } from "lib/api/auth";
import { useCamerasAll } from "lib/api/cameras";
import { useFeeders } from "lib/api/feeders";
import * as types from "lib/types";

const CAMERA_SELECT_LABEL = "Cameras";
const FEEDER_SELECT_LABEL = "Feeders";
const SELECT_ALL_CAMERAS = "<select-all-cameras>";
const SELECT_ALL_FEEDERS = "<select-all-feeders>";

interface UserDialogProps {
  user: types.AuthUserResponse;
  onClose: () => void;
}

function UserDialog({ user, onClose }: UserDialogProps) {
  const { user: currentUser } = useAuthContext();
  const authUpdateUser = useAuthUpdateUser();
  const authDelete = useAuthDelete();
  const camerasAll = useCamerasAll();
  const feeders = useFeeders();

  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState(user.role);
  const [allCameras, setAllCameras] = useState(user.assigned_cameras === null);
  const [assignedCameras, setAssignedCameras] = useState(
    user.assigned_cameras || [],
  );
  const [allFeeders, setAllFeeders] = useState(user.assigned_feeders === null);
  const [assignedFeeders, setAssignedFeeders] = useState(
    user.assigned_feeders || [],
  );
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const feederList = feeders.data?.feeders || [];

  const handleSave = () => {
    authUpdateUser.mutate(
      {
        id: user.id,
        name,
        username,
        role,
        assigned_cameras: allCameras ? null : assignedCameras,
        assigned_feeders: allFeeders ? null : assignedFeeders,
        preferences: user.preferences,
        auth_provider: user.auth_provider,
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  const handleDeleteUser = () => {
    authDelete.mutate(user, {
      onSuccess: () => {
        onClose();
      },
    });
  };

  const handleOpenChangePassword = () => {
    setIsChangePasswordOpen(true);
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
  };

  const handleCameraChange = (event: SelectChangeEvent<string[]>) => {
    const value =
      typeof event.target.value === "string"
        ? event.target.value.split(",")
        : event.target.value;
    if (
      value.includes(SELECT_ALL_CAMERAS) &&
      assignedCameras.length === Object.keys(camerasAll.combinedData).length
    ) {
      setAssignedCameras([]);
      return;
    }

    if (value.includes(SELECT_ALL_CAMERAS)) {
      const allCameraIds = Object.values(camerasAll.combinedData).map(
        (camera) => camera.identifier,
      );
      setAssignedCameras(allCameraIds);
      return;
    }
    setAssignedCameras(value);
  };

  const handleFeederChange = (event: SelectChangeEvent<string[]>) => {
    const value =
      typeof event.target.value === "string"
        ? event.target.value.split(",")
        : event.target.value;
    if (
      value.includes(SELECT_ALL_FEEDERS) &&
      assignedFeeders.length === feederList.length
    ) {
      setAssignedFeeders([]);
      return;
    }

    if (value.includes(SELECT_ALL_FEEDERS)) {
      setAssignedFeeders(feederList.map((feeder) => feeder.id));
      return;
    }
    setAssignedFeeders(value);
  };

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{name}</DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Display Name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            margin="dense"
            label="Username"
            fullWidth
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>Role</InputLabel>
            <Select
              label="Role"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as types.AuthUserResponse["role"])
              }
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="write">Write</MenuItem>
              <MenuItem value="read">Read</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth margin="dense">
            <FormControlLabel
              control={
                <Checkbox
                  checked={allCameras}
                  onChange={(event) => setAllCameras(event.target.checked)}
                />
              }
              label="All cameras"
            />
          </FormControl>
          <FormControl fullWidth margin="dense" disabled={allCameras}>
            <InputLabel>{CAMERA_SELECT_LABEL}</InputLabel>
            <Select
              multiple
              label={CAMERA_SELECT_LABEL}
              value={assignedCameras}
              onChange={handleCameraChange}
              renderValue={(selected) =>
                (selected as string[])
                  .map(
                    (cameraId) =>
                      camerasAll.combinedData[cameraId]?.name || cameraId,
                  )
                  .join(", ")
              }
            >
              <MenuItem value={SELECT_ALL_CAMERAS}>
                <Checkbox
                  checked={
                    assignedCameras.length ===
                    Object.keys(camerasAll.combinedData).length
                  }
                />
                <ListItemText primary="Select all cameras" />
              </MenuItem>
              {Object.values(camerasAll.combinedData).map((camera) => (
                <MenuItem key={camera.identifier} value={camera.identifier}>
                  <Checkbox
                    checked={assignedCameras.includes(camera.identifier)}
                  />
                  <ListItemText primary={camera.name} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth margin="dense">
            <FormControlLabel
              control={
                <Checkbox
                  checked={allFeeders}
                  onChange={(event) => setAllFeeders(event.target.checked)}
                />
              }
              label="All feeders"
            />
          </FormControl>
          <FormControl fullWidth margin="dense" disabled={allFeeders}>
            <InputLabel>{FEEDER_SELECT_LABEL}</InputLabel>
            <Select
              multiple
              label={FEEDER_SELECT_LABEL}
              value={assignedFeeders}
              onChange={handleFeederChange}
              renderValue={(selected) =>
                (selected as string[])
                  .map(
                    (feederId) =>
                      feederList.find((feeder) => feeder.id === feederId)
                        ?.name || feederId,
                  )
                  .join(", ")
              }
            >
              <MenuItem value={SELECT_ALL_FEEDERS}>
                <Checkbox
                  checked={
                    assignedFeeders.length === feederList.length &&
                    feederList.length > 0
                  }
                />
                <ListItemText primary="Select all feeders" />
              </MenuItem>
              {feederList.map((feeder) => (
                <MenuItem key={feeder.id} value={feeder.id}>
                  <Checkbox checked={assignedFeeders.includes(feeder.id)} />
                  <ListItemText
                    primary={feeder.name}
                    secondary={feeder.available ? feeder.id : "Offline"}
                  />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleDeleteUser}
            color="error"
            disabled={!!(currentUser && currentUser.username === user.username)}
          >
            Delete User
          </Button>
          <Button onClick={handleOpenChangePassword} color="primary">
            Change Password
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={authUpdateUser.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      {isChangePasswordOpen && (
        <ChangePasswordDialog onClose={handleCloseChangePassword} user={user} />
      )}
    </>
  );
}

export default UserDialog;
