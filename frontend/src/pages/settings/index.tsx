import {
  ArrowRight,
  DataBlob,
  Dashboard,
  Download,
  Script,
  SettingsEdit,
  Time,
  Trigger,
  UserMultiple,
  Video,
} from "@carbon/icons-react";
import { ListItemButton } from "@mui/material";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Container from "@mui/material/Container";
import List from "@mui/material/List";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import { Link } from "react-router-dom";

import { useAuthContext } from "context/AuthContext";
import { useHideScrollbar } from "hooks/UseHideScrollbar";
import { useTitle } from "hooks/UseTitle";

function Settings() {
  useTitle("Settings");
  useHideScrollbar();

  const { auth, user } = useAuthContext();

  const settingsMenuItems = [
    {
      name: "Configuration",
      description: "Edit the YAML configuration",
      path: "/settings/configuration",
      icon: <SettingsEdit size={23} />,
      color: "blue",
      disabled: false,
      disabledReason: null,
    },
    {
      name: "Cameras",
      description: "Add and review cameras",
      path: "/settings/cameras",
      icon: <Video size={23} />,
      color: "indigo",
      disabled: false,
      disabledReason: null,
    },
    {
      name: "User Management",
      description: "Create, edit, and delete users",
      path: "/settings/users",
      icon: <UserMultiple size={23} />,
      color: "green",
      disabled: !auth.enabled || user?.role !== "admin",
      disabledReason: !auth.enabled
        ? "Enable authentication to manage users"
        : "Only admins can manage users",
    },
    {
      name: "LDAP / Active Directory",
      description: "Configure directory authentication",
      path: "/settings/ldap",
      icon: <UserMultiple size={23} />,
      color: "indigo",
      disabled: !auth.enabled || user?.role !== "admin",
      disabledReason: !auth.enabled
        ? "Enable authentication to configure LDAP"
        : "Only admins can configure LDAP",
    },
    {
      name: "Camera Access",
      description: "Map users and directory groups to cameras",
      path: "/settings/camera-access",
      icon: <Video size={23} />,
      color: "teal",
      disabled: !auth.enabled || user?.role !== "admin",
      disabledReason: !auth.enabled
        ? "Enable authentication to configure camera access"
        : "Only admins can configure camera access",
    },
    {
      name: "Recording Schedule",
      description: "Configure NVR recording windows",
      path: "/settings/recording-schedule",
      icon: <Time size={23} />,
      color: "purple",
      disabled:
        auth.enabled && user?.role !== "admin" && user?.role !== "write",
      disabledReason: !auth.enabled
        ? null
        : "Only admins and write users can configure recording schedules",
    },
    {
      name: "Feeders",
      description: "Review Koser Stall feeding stations",
      path: "/feeders",
      icon: <DataBlob size={23} />,
      color: "green",
      disabled: false,
      disabledReason: null,
    },
    {
      name: "Export Destinations",
      description: "Configure browser and server-side export targets",
      path: "/settings/export-destinations",
      icon: <Download size={23} />,
      color: "blue",
      disabled: !auth.enabled || user?.role !== "admin",
      disabledReason: !auth.enabled
        ? "Enable authentication to configure export destinations"
        : "Only admins can configure export destinations",
    },
    {
      name: "System Health",
      description: "Review server load, storage, streams, and camera health",
      path: "/settings/system-health",
      icon: <Dashboard size={23} />,
      color: "blue",
      disabled: false,
      disabledReason: null,
    },
    {
      name: "iMouse Control",
      description: "Control Raspberry camera focus, exposure, gain, HDR, and lights",
      path: "/settings/imouse",
      icon: <Video size={23} />,
      color: "teal",
      disabled: !auth.enabled || user?.role !== "admin",
      disabledReason: !auth.enabled
        ? "Enable authentication to control iMouse cameras"
        : "Only admins can control iMouse cameras",
    },
    {
      name: "System Events",
      description: "View system events dispatched by the server",
      path: "/settings/system-events",
      icon: <Trigger size={23} />,
      color: "purple",
      disabled: false,
      disabledReason: null,
    },
    {
      name: "Template Editor",
      description: "Test and render Jinja2 templates",
      path: "/settings/template-editor",
      icon: <Script size={23} />,
      color: "teal",
      disabled: false,
      disabledReason: null,
    },
    {
      name: "Logs",
      description: "View system logs",
      path: "/settings/logs",
      icon: <DataBlob size={23} />,
      color: "orange",
      disabled: true,
      disabledReason: "Not implemented yet",
    },
  ];

  return (
    <Container maxWidth={false} sx={{ paddingX: { xs: 1, md: 2 } }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "70vh",
        }}
      >
        <Card sx={{ maxWidth: 600, width: "100%" }}>
          <CardContent sx={{ paddingX: { xs: 0.5, md: 2 } }}>
            <List sx={{ width: "100%", maxWidth: 600 }}>
              {settingsMenuItems.map((item) => (
                <ListItemButton
                  disabled={item.disabled}
                  key={item.path}
                  component={Link}
                  to={item.path}
                  sx={{
                    "&:hover": {
                      bgcolor: "action.hover",
                    },
                  }}
                >
                  <ListItemAvatar>
                    <Avatar
                      sx={{
                        bgcolor: item.color,
                        color: "primary.contrastText",
                      }}
                    >
                      {item.icon}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={item.name}
                    secondary={
                      item.disabled
                        ? `${item.description}. ${item.disabledReason}`
                        : item.description
                    }
                  />
                  <ArrowRight fontSize="small" />
                </ListItemButton>
              ))}
            </List>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}

export default Settings;
