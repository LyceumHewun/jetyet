export type Row = Record<string, any>;

export type Role = "admin" | "subscriber";

export type TemplateFormat = "mihomo" | "sing-box";

export type SubscriptionFormat = TemplateFormat | "shadowrocket";

export type Session = {
  username: string;
  role: Role;
};

export type PortalTemplateSummary = {
  id: string;
  name: string;
  format: TemplateFormat;
  personal: boolean;
  published: boolean;
  draft: boolean;
};

export type PortalData = {
  name: string;
  expired: boolean;
  templates: PortalTemplateSummary[];
  defaultTemplates: Record<TemplateFormat, string>;
  defaultLink: string | null;
  formats: Record<SubscriptionFormat, string> | null;
  traffic: PortalTraffic;
};

export type PortalTraffic = {
  inbound: number;
  outbound: number;
  used: number;
  limit: number | null;
  direction: "in" | "out" | "both";
  periodStart: number;
  nextReset: number;
  samples: { at: number; inbound: number; outbound: number }[];
};

export type PortalTemplateDetail = PortalTemplateSummary & {
  body: string | null;
  link: string | null;
};

export type Tab =
  | "Overview"
  | "VPS"
  | "Nodes"
  | "Users"
  | "Templates"
  | "Operations"
  | "Alerts";

export type ActivitySummary = {
  openAlerts: number;
  unreadAlerts: number;
  activeTasks: number;
  failedTasks24h: number;
};

export type State = {
  controlPlane: Row | null;
  hosts: Row[];
  nodes: Row[];
  users: Row[];
  templates: Row[];
  alerts: Row[];
  tasks: Row[];
  workers: Row[];
  activitySummary?: ActivitySummary;
  origin: string;
};
