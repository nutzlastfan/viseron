import { AxiosError } from "axios";
import { Dayjs } from "dayjs";

export type SystemInformation = {
  version: string;
  git_commit: string;
  safe_mode: boolean;
};

type WebSocketAuthOkResponse = {
  type: "auth_ok";
  message: string;
  system_information: SystemInformation;
};

type WebSocketAuthRequiredResponse = {
  type: "auth_required";
  message: string;
};

type WebSocketAuthNotRequiredResponse = {
  type: "auth_not_required";
  message: string;
  system_information: SystemInformation;
};

type WebSocketAuthInvalidResponse = {
  type: "auth_failed";
  message: string;
};

export type WebSocketAuthResponse =
  | WebSocketAuthOkResponse
  | WebSocketAuthRequiredResponse
  | WebSocketAuthNotRequiredResponse
  | WebSocketAuthInvalidResponse;

type WebSocketPongResponse = {
  command_id: number;
  type: "pong";
};

export type WebSocketSubscriptionResultResponse = {
  command_id: number;
  type: "subscription_result";
  success: true;
  result: Event | HlsAvailableTimespans | DownloadFileResponse;
};

export type WebSocketSubscriptionErrorResponse = {
  command_id: number;
  type: "subscription_result";
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type WebSocketSubscriptionCancelResponse = {
  command_id: number;
  type: "cancel_subscription";
};

export type WebSocketResultResponse = {
  command_id: number;
  type: "result";
  success: true;
  result: any;
};

export type WebSocketResultErrorResponse = {
  command_id: number;
  type: "result";
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type WebSocketResponse =
  | WebSocketPongResponse
  | WebSocketSubscriptionResultResponse
  | WebSocketSubscriptionErrorResponse
  | WebSocketSubscriptionCancelResponse
  | WebSocketResultResponse
  | WebSocketResultErrorResponse;

export type APISuccessResponse = {
  success: true;
};

export type APIErrorResponse = AxiosError<{
  status: number;
  error: string;
}>;

export type AuthEnabledResponse = {
  enabled: boolean;
  onboarding_complete: boolean;
};

export type AuthTokenResponse = {
  header: string;
  payload: string;
  expiration: number;
  expires_at: string;
  expires_at_timestamp: number;
  session_expires_at: string;
  session_expires_at_timestamp: number;
};

export type StoredTokens = {
  header: string;
  payload: string;
  expiration: number;
  expires_at: Dayjs;
  expires_at_timestamp: number;
  session_expires_at: Dayjs;
  session_expires_at_timestamp: number;
};

export type UserPreferences = {
  timezone?: string | null;
  date_format?: string | null;
  time_format?: "12h" | "24h" | null;
};

export type ZoomPanTransform = {
  scale: number;
  centerX: number;
  centerY: number;
  viewportAspectRatio?: number;
  flip?: boolean;
};

export type AuthUserResponse = {
  id: string;
  name: string;
  username: string;
  role: "admin" | "read" | "write";
  assigned_cameras: string[] | null;
  assigned_feeders: string[] | null;
  camera_permissions?: Record<string, CameraPermission[]> | null;
  preferences: UserPreferences | null;
  auth_provider: "local" | "ldap";
};

export type AuthUsersResponse = {
  users: AuthUserResponse[];
};

export type AuthLoginResponse = AuthTokenResponse;
export type OnboardingResponse = AuthTokenResponse;

export type LDAPRole = "admin" | "read" | "write" | "deny";

export type LDAPConfig = {
  enabled: boolean;
  url: string;
  bind_dn: string;
  bind_password: string;
  bind_password_set: boolean;
  user_base_dn: string;
  user_filter: string;
  username_attribute: string;
  name_attribute: string;
  group_base_dn: string;
  group_filter: string;
  admin_groups: string[];
  write_groups: string[];
  read_groups: string[];
  default_role: LDAPRole;
};

export type LDAPConfigResponse = {
  config: LDAPConfig;
};

export type CameraAccessGroup = {
  id: string;
  name: string;
  cameras: string[];
};

export type FeederAccessGroup = {
  id: string;
  name: string;
  feeders: string[];
};

export type CameraPermission =
  | "view_live"
  | "view_recordings"
  | "manual_record"
  | "delete_recordings"
  | "manage_schedule"
  | "admin_override";

export type LDAPCameraAccessRule = {
  groups: string[];
  camera_groups: string[];
  cameras: string[];
  permissions: CameraPermission[];
};

export type LDAPFeederAccessRule = {
  groups: string[];
  feeder_groups: string[];
  feeders: string[];
};

export type CameraAccessConfig = {
  camera_groups: CameraAccessGroup[];
  ldap_camera_access: LDAPCameraAccessRule[];
  feeder_groups: FeederAccessGroup[];
  ldap_feeder_access: LDAPFeederAccessRule[];
};

export type CameraAccessConfigResponse = {
  config: CameraAccessConfig;
};

export type CameraAccessSaveResponse = {
  success: boolean;
  restart_required: boolean;
  errors: string[];
};

export type CameraAccessMatchedRule = LDAPCameraAccessRule & {
  index: number;
  matched_groups?: string[];
  expanded_cameras: string[];
  expanded_groups?: {
    id: string;
    name: string;
    cameras: string[];
  }[];
  uses_role_default_permissions?: boolean;
};

export type EffectiveCameraAccessResponse = {
  username: string;
  name: string;
  role: LDAPRole;
  assigned_cameras: string[] | null;
  assigned_feeders: string[] | null;
  camera_permissions: Record<string, CameraPermission[]> | null;
  groups: string[];
  matched_camera_rules: CameraAccessMatchedRule[];
};

export type CameraAccessReportResponse = {
  rules: CameraAccessMatchedRule[];
};

export type FeederSettings = {
  mode: boolean | null;
  door: boolean | null;
};

export type FeederAnimal = {
  id: number;
  tagid: string;
};

export type FeederLock = {
  id: number;
  day: number;
  from_time: string;
  to_time: string;
};

export type FeederProtocolEntry = {
  timestamp: string;
  tagid: string;
  action: number;
  action_label: string;
  duration: number;
};

export type Feeder = {
  id: string;
  name: string;
  host: string;
  port: number;
  read_only: boolean;
  available: boolean;
  error: string | null;
  settings: FeederSettings;
  animals: FeederAnimal[];
  locks: FeederLock[];
  protocol: FeederProtocolEntry[];
};

export type FeederRoom = {
  id: string;
  name: string;
  cameras: string[];
  feeders: string[];
};

export type FeedersResponse = {
  rooms: FeederRoom[];
  feeders: Feeder[];
  read_only: boolean;
};

export type FeederResponse = {
  feeder: Feeder;
};

export type FeederProtocolResponse = {
  protocol: FeederProtocolEntry[];
};

export type LDAPSaveResponse = {
  success: boolean;
  restart_required: boolean;
  errors: string[];
};

export type LDAPTestResponse = {
  bind: boolean;
  user: {
    username: string;
    name: string;
    role: LDAPRole;
    assigned_cameras: string[] | null;
    groups: number;
    password_validated: boolean;
  } | null;
};

export type AccessToken = {
  id: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  last_used_by: string | null;
};

export type AccessTokensResponse = {
  access_tokens: AccessToken[];
};

export type AccessTokenCreateResponse = AccessToken & { token: string };

export interface Recording {
  id: number;
  camera_identifier: string;
  start_time: string;
  start_timestamp: number;
  end_time: string;
  end_timestamp: number;
  trigger_type: string;
  trigger_id: number | null;
  thumbnail_path: string;
  hls_url: string;
}

export interface RecordingsAll {
  [identifier: string]: {
    [date: string]: {
      [id: string]: Recording;
    };
  };
}

export interface RecordingsCamera {
  [date: string]: {
    [id: string]: Recording;
  };
}

export interface Camera {
  identifier: string;
  name: string;
  width: number;
  height: number;
  access_token: string;
  mainstream: {
    width: number;
    height: number;
  };
  still_image: {
    refresh_interval: number;
    available: boolean;
    width: number;
    height: number;
  };
  failed: false;
  is_on: boolean;
  connected: boolean;
  live_stream_available: boolean;
  is_recording: boolean;
  effective_policy?: CameraPolicyStatus;
  status: CameraRuntimeStatus;
}

export interface Cameras {
  [identifier: string]: Camera;
}

export interface FailedCamera {
  identifier: string;
  name: string;
  width: number;
  height: number;
  mainstream: {
    width: number;
    height: number;
  };
  live_stream_available: boolean;
  error: string;
  retrying: boolean;
  failed: true;
  status: CameraRuntimeStatus;
}

export interface FailedCameras {
  [identifier: string]: FailedCamera;
}

export interface CamerasOrFailedCameras {
  [identifier: string]: Camera | FailedCamera;
}

export type CameraPolicyAction = "recording" | "live";

export type CameraStatusSeverity =
  | "default"
  | "info"
  | "success"
  | "warning"
  | "error";

export type CameraRuntimeStatus = {
  state:
    | "connected"
    | "recording"
    | "recording_blocked"
    | "live_blocked"
    | "stale"
    | "offline"
    | "off"
    | "setup_failed"
    | "setup_retrying";
  label: string;
  severity: CameraStatusSeverity;
  detail: string | null;
  live: {
    available: boolean;
    reachable: boolean;
    blocked: boolean;
    reason: string | null;
  };
  recording: {
    active: boolean;
    blocked: boolean;
    reason: string | null;
    state:
      | "ready"
      | "recording"
      | "blocked"
      | "stale"
      | "offline"
      | "off"
      | "failed";
  };
  last_frame_age: number | null;
  latest_segment_age: number | null;
  stale_frame: {
    stale: boolean;
    threshold: number;
    age: number | null;
  };
};

export type CameraPolicyDecision = {
  allowed: boolean;
  reason: string | null;
  rule_id: string | null;
  rule_name: string | null;
  override_active: boolean;
  override_until: string | null;
  scheduled_recording?: boolean;
};

export type CameraPolicyStatus = {
  recording: CameraPolicyDecision;
  live: CameraPolicyDecision;
};

export type RecordingScheduleAction = CameraPolicyAction;
export type RecordingScheduleDecision = CameraPolicyDecision;
export type RecordingScheduleStatus = CameraPolicyStatus;
export type RecordingScheduleRecordingMode = "record" | "block" | "ignore";

export type RecordingScheduleRule = {
  id: string;
  name: string;
  enabled: boolean;
  reason: string | null;
  recording: RecordingScheduleRecordingMode;
  block_live: boolean;
  targets: {
    cameras: string[];
    camera_groups: string[];
  };
  weekdays: number[];
  start_time: string;
  end_time: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type RecordingScheduleOverrides = Record<
  string,
  Partial<Record<RecordingScheduleAction, boolean>>
>;

export type RecordingScheduleMetadata = {
  last_saved_at?: string | null;
  last_saved_by?: string | null;
  last_saved_role?: string | null;
};

export type RecordingScheduleConfig = {
  rules: RecordingScheduleRule[];
  overrides: RecordingScheduleOverrides;
  metadata?: RecordingScheduleMetadata;
};

export type RecordingScheduleResponse = {
  config: RecordingScheduleConfig;
  status: Record<string, RecordingScheduleStatus>;
  camera_groups: CameraAccessGroup[];
};

export interface DetectedObject {
  label: string;
  confidence: number;
  rel_width: number;
  rel_height: number;
  rel_x1: number;
  rel_y1: number;
  rel_x2: number;
  rel_y2: number;
}

export type EventBase = {
  timestamp: number;
};

export type Event = EventBase & {
  name: string;
  data: { [key: string]: any };
};

export type EventCameraRegistered = Event & {
  name: "camera_registered";
  data: Camera;
};

export type EventRecorder = Event & {
  data: {
    camera: Camera;
    recording: Recording & {
      start_time: string;
      start_timestamp: number;
      end_time: string;
      end_timestamp: number;
      objects: [DetectedObject];
    };
  };
};

export type EventRecorderStart = EventRecorder & {
  name: "recorder_start";
};
export type EventRecorderStop = EventRecorder & {
  name: "recorder_stop";
};
export interface EntityAttributes {
  name: string;
  domain: string;
  [key: string]: any;
}

type CameraBaseEvent = {
  camera_identifier: string;
  id: number;
  created_at: string;
  created_at_timestamp: number;
  lookback: number;
};

type CameraBaseTimedEvent = CameraBaseEvent & {
  start_time: string;
  start_timestamp: number;
  end_time: string | null;
  end_timestamp: number | null;
  duration: number | null;
};
export type CameraMotionEvent = CameraBaseTimedEvent & {
  type: "motion";
  snapshot_path: string;
};
export type CameraRecordingEvent = CameraBaseTimedEvent & {
  type: "recording";
  trigger_type: "motion" | "object" | null;
  hls_url: string;
  thumbnail_path: string;
};
export type CameraTimedEvents = CameraMotionEvent | CameraRecordingEvent;

type CameraBaseSnapshotEvent = CameraBaseEvent & {
  time: string;
  timestamp: number;
  snapshot_path: string;
};
export type CameraObjectEvent = CameraBaseSnapshotEvent & {
  type: "object";
  time: string;
  timestamp: number;
  label: string;
  confidence: number;
};
export type CameraFaceRecognitionEvent = CameraBaseSnapshotEvent & {
  type: "face_recognition";
  data: {
    name: string;
    confidence: number;
    [key: string]: any;
  };
};
export type CameraLicensePlateRecognitionEvent = CameraBaseSnapshotEvent & {
  type: "license_plate_recognition";
  data: {
    camera_identifier: string;
    known: boolean;
    plate: string;
    confidence: number;
  };
};

export type CameraEvent =
  | CameraMotionEvent
  | CameraObjectEvent
  | CameraRecordingEvent
  | CameraFaceRecognitionEvent
  | CameraLicensePlateRecognitionEvent;

export type CameraEvents = {
  events: CameraEvent[];
};

export type CameraSnapshotEvent =
  | CameraObjectEvent
  | CameraFaceRecognitionEvent
  | CameraLicensePlateRecognitionEvent;
export type CameraSnapshotEvents = Array<CameraSnapshotEvent>;

export type CameraObjectEvents = Array<CameraObjectEvent>;

export type EventsAmount = {
  events_amount: {
    [date: string]: {
      motion?: number;
      object?: number;
      recording?: number;
      face_recognition?: number;
      license_plate_recognition?: number;
    };
  };
};

export type EventsDatesOfInterest = {
  dates_of_interest: {
    [date: string]: {
      events: number;
      timespan_available: boolean;
    };
  };
};

export interface Entity {
  entity_id: string;
  state: string;
  attributes: EntityAttributes;
}

export interface Entities {
  [index: string]: Entity;
}

export interface State {
  entity_id: string;
  state: string;
  attributes: EntityAttributes;
  timestamp: number;
}

export type StateChangedEvent = EventBase & {
  name: "state_changed";
  data: {
    entity_id: string;
    current_state: State;
    previous_state: State;
  };
};

export type HlsAvailableTimespan = {
  start: number;
  end: number;
  duration: number;
};

export type HlsAvailableTimespans = {
  timespans: HlsAvailableTimespan[];
};

export type DownloadFileResponse = {
  filename: string;
  token?: string;
  destination?: "browser" | string;
  destination_name?: string;
  downloaded?: boolean;
};

export type ExportDestination = string;

export type ExportDestinationConfig = {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
};

export type ExportDestinationsResponse = {
  destinations: ExportDestinationConfig[];
  default_destination: string;
};

export type ExportDestinationsSaveResponse = {
  saved: boolean;
  destinations: ExportDestinationConfig[];
};

export type SystemDispatchedEvents = {
  events: string[];
};

export type SystemHealthStorage = {
  path: string;
  exists: boolean;
  total: number;
  used: number;
  free: number;
  percent_used: number | null;
  warning_level: "warning" | "critical" | "error" | null;
  warning: string | null;
  device: string | null;
  fstype: string | null;
  is_mount: boolean;
  writable: boolean;
  write_error: string | null;
};

export type SystemHealthFfmpegSummary = {
  count: number;
  cpu_percent: number;
  memory_percent: number;
  rss: number;
  pids: number[];
};

export type SystemHealthCamera = {
  identifier: string;
  name: string;
  connected: boolean;
  is_on: boolean;
  is_recording: boolean;
  live_stream_available: boolean;
  width: number | null;
  height: number | null;
  latest_temp_segment_age: number | null;
  latest_segment_age: number | null;
  ffmpeg: SystemHealthFfmpegSummary;
  failed: boolean;
  error: string | null;
  status: CameraRuntimeStatus | null;
  stale_frame: boolean;
};

export type SystemHealthResponse = {
  generated_at: number;
  system: {
    load_average: number[] | null;
    cpu_count: number | null;
    memory: {
      total: number;
      available: number;
      used: number;
    };
    nofile: {
      soft: number;
      hard: number;
    };
  };
  storage: SystemHealthStorage[];
  cameras: SystemHealthCamera[];
  ffmpeg: {
    process_count: number;
    total_cpu_percent: number;
    total_rss: number;
    by_camera: Record<string, SystemHealthFfmpegSummary>;
  };
  summary: {
    camera_count: number;
    connected_cameras: number;
    recording_cameras: number;
    offline_cameras: number;
    stale_cameras: number;
    cameras_without_ffmpeg: string[];
  };
};

export type IMouseCommand =
  | "focus_minus"
  | "focus_plus"
  | "focus_reset"
  | "focus_auto"
  | "ev_minus"
  | "ev0"
  | "ev_plus"
  | "exposure_minus"
  | "exposure_plus"
  | "gain_minus"
  | "gain_plus"
  | "hdr_on"
  | "hdr_off"
  | "daylight"
  | "nightlight";

export type IMouseCamera = {
  id: string;
  side: "left" | "right";
  camera_identifier: string;
  name: string;
  available: boolean;
};

export type IMouseDevice = {
  id: string;
  name: string;
  host: string;
  reachable: boolean;
  error: string | null;
  flask_cameras: string[];
  cameras: IMouseCamera[];
};

export type IMouseResponse = {
  devices: IMouseDevice[];
};

export type IMouseCommandResponse = {
  device_id: string;
  camera_id?: string;
  command?: IMouseCommand;
  success?: boolean;
  msg?: string;
  message?: string;
  value?: number;
  cameras?: string[];
};

export type SetupError = {
  source: string;
  message: string;
  timestamp?: number;
  component_name?: string;
  domain?: string;
  identifier?: string;
};

export type DomainStatus = {
  component: string;
  domain: string;
  identifier: string;
  config: Record<string, unknown>;
  require_domains: { domain: string; identifier: string }[];
  optional_domains: { domain: string; identifier: string }[];
  state: string;
  error: string | null;
};

export type ComponentStatus = {
  name: string;
  state: string;
  errors: SetupError[];
  validation_error: string | null;
  domains: DomainStatus[];
};

export type SetupStatusResponse = {
  components: ComponentStatus[];
};

export type ComponentSetupStatusEvent = Event & {
  data: {
    component: string;
    state: string;
    error: string | null;
    validation_error: string | null;
  };
};

export type DomainSetupStatusEvent = Event & {
  data: {
    component: string;
    domain: string;
    identifier: string;
    state: string;
    error: string | null;
  };
};
