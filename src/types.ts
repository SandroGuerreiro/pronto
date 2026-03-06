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

export interface Reviews {
  totalCount: number;
}

export interface MergeQueueEntry {
  position: number;
}

export interface Owner {
  login: string;
}

export interface Repository {
  name: string;
  owner: Owner;
}

export interface Comments {
  totalCount: number;
}

export interface StatusCheckRollup {
  state: string;
}

export interface Commit {
  statusCheckRollup: StatusCheckRollup | null;
}

export interface CommitNode {
  commit: Commit;
}

export interface CommitConnection {
  nodes: CommitNode[];
}

export interface ReviewThread {
  isResolved: boolean;
  comments: { totalCount: number };
}

export interface ReviewThreads {
  nodes: ReviewThread[];
}

export interface PullRequest {
  title: string;
  url: string;
  state: string;
  merged: boolean;
  createdAt: string;
  repository: Repository;
  mergeQueueEntry: MergeQueueEntry | null;
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

export interface PrElementChanges {
  became_review_required: boolean;
  became_changes_requested: boolean;
  became_approved: boolean;
  checks_failed: boolean;
  checks_recovered: boolean;
  kicked_from_queue: boolean;
  new_comment: boolean;
}

export interface FetchResult {
  open: PullRequest[];
  recently_merged: PullRequest[];
  recently_closed: PullRequest[];
  followed_open: PullRequest[];
  followed_recently_merged: PullRequest[];
  followed_recently_closed: PullRequest[];
  attention_urls: string[];
  element_changes: Record<string, PrElementChanges>;
  workflow_status: WorkflowStatus | null;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface HiddenPr {
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
}

export interface Settings {
  poll_interval_secs: number;
  notifications_enabled: boolean;
  show_recently_merged: boolean;
  merged_window_hours: number;
  show_closed: boolean;
  closed_window_hours: number;
  favorite_orgs: string[];
  favorite_repos: string[];
  collapsed_accordions: string[];
  hidden_orgs: string[];
  hidden_repos: string[];
  hidden_prs: HiddenPr[];
  followed_users: string[];
  followed_prs: string[];
  group_by_repository: boolean;
  workflow_monitor_enabled: boolean;
  workflow_org: string;
  workflow_repo: string;
  workflow_name: string;
  keybindings?: Record<string, string>;
  global_toggle_shortcut?: string;
  global_reload_shortcut?: string;
  global_follow_shortcut?: string;
  notification_prefs_owned: NotificationPreferences;
  notification_prefs_followed: NotificationPreferences;
  notify_on_merged: boolean;
  notify_on_closed: boolean;
  homebrew_check_enabled: boolean;
  homebrew_check_interval_secs: number;
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  navigate_down: "j",
  navigate_up: "k",
  expand: "l",
  collapse: "h",
  open_pr: "Enter",
  hide_pr: "i",
  copy_url: "c",
  tab_owned: "1",
  tab_followed: "2",
  tab_merged: "3",
  tab_closed: "4",
  global_toggle: "Super+Ctrl+P",
  global_reload: "Super+Ctrl+R",
};

export type TabName = "mine" | "followed" | "merged" | "closed" | "settings";
export type FilterType = "all" | "needs-review" | "changes-requested" | "approved" | "failing" | "attention";
