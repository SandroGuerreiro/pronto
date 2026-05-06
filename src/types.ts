export interface NotifyData {
  kind: string;
  title: string;
  message: string;
}

export interface HomebrewStatus {
  available: boolean;
  update_available: boolean;
  installed_version: string;
  latest_version: string;
  checked_at: string;
}

interface Reviews {
  totalCount: number;
}

interface MergeQueueEntry {
  position: number;
}

interface Owner {
  login: string;
}

interface Repository {
  name: string;
  owner: Owner;
}

interface Comments {
  totalCount: number;
}

interface StatusCheckRollup {
  state: string;
}

interface Commit {
  statusCheckRollup: StatusCheckRollup | null;
}

interface CommitNode {
  commit: Commit;
}

interface CommitConnection {
  nodes: CommitNode[];
}

interface ReviewThread {
  isResolved: boolean;
  comments: { totalCount: number };
}

interface ReviewThreads {
  nodes: ReviewThread[];
}

export interface PullRequest {
  title: string;
  url: string;
  state: string;
  merged: boolean;
  isDraft: boolean;
  createdAt: string;
  repository: Repository;
  mergeQueueEntry: MergeQueueEntry | null;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  reviews: Reviews;
  comments: Comments;
  reviewThreads: ReviewThreads;
  commits: CommitConnection;
  author: Owner;
}

export interface WorkflowStatus {
  conclusion: string;
  status: string;
  workflow_name: string;
  repo: string;
  updated_at: string;
  html_url: string;
}

export interface Release {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

export interface PrElementChanges {
  became_review_required: boolean;
  became_changes_requested: boolean;
  became_approved: boolean;
  checks_failed: boolean;
  checks_recovered: boolean;
  kicked_from_queue: boolean;
  new_comment: boolean;
  new_comment_participated: boolean;
}

export interface FetchResult {
  open: PullRequest[];
  recently_merged: PullRequest[];
  recently_closed: PullRequest[];
  watched_open: PullRequest[];
  watched_recently_merged: PullRequest[];
  watched_recently_closed: PullRequest[];
  attention_urls: string[];
  element_changes: Record<string, PrElementChanges>;
  workflow_status: WorkflowStatus | null;
  viewer_login: string;
  viewer_avatar_url: string;
  review_requests: PullRequest[];
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface HiddenPr {
  url: string;
  title: string;
}

export interface NotificationPreferences {
  review_required: boolean;
  changes_requested: boolean;
  approved: boolean;
  checks_failed: boolean;
  checks_recovered: boolean;
  kicked_from_queue: boolean;
  new_comment: boolean;
  new_comment_participated: boolean;
}

export interface Settings {
  poll_interval_secs: number;
  use_native_notifications: boolean;
  show_recently_merged: boolean;
  merged_window_hours: number;
  show_closed: boolean;
  closed_window_hours: number;
  show_requests: boolean;
  favorite_orgs: string[];
  favorite_repos: string[];
  collapsed_accordions: string[];
  hidden_orgs: string[];
  hidden_repos: string[];
  hidden_prs: HiddenPr[];
  watched_users: string[];
  watched_prs: string[];
  auto_watch_commented_prs: boolean;
  group_by_repository: boolean;
  workflow_monitor_enabled: boolean;
  workflow_org: string;
  workflow_repo: string;
  workflow_name: string;
  keybindings?: Record<string, string>;
  global_toggle_shortcut?: string;
  global_reload_shortcut?: string;
  global_watch_shortcut?: string;
  notification_prefs_owned: NotificationPreferences;
  notification_prefs_watched: NotificationPreferences;
  notify_on_merged: boolean;
  notify_on_closed: boolean;
  homebrew_check_enabled: boolean;
  homebrew_check_interval_secs: number;
  popup_screen?: string;
  notification_sound: boolean;
  notification_volume: number;
  notification_duration_secs: number;
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  navigate_down: "j",
  navigate_up: "k",
  expand: "l",
  collapse: "h",
  open_pr: "Enter",
  hide_pr: "i",
  copy_url: "c",
  global_toggle: "Super+Ctrl+P",
  global_reload: "Super+Ctrl+R",
};

export type TabName = "mine" | "requests" | "watched" | "merged" | "closed" | "settings";
export type FilterType = "all" | "needs-review" | "changes-requested" | "approved" | "failing" | "attention";
