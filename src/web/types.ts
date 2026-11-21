export type Row = Record<string, any>;

export type Role = "admin" | "subscriber";

export type Session = {
  username: string;
  role: Role;
};

export type PortalTemplateSummary = {
  id: string;
  name: string;
  personal: boolean;
  published: boolean;
  draft: boolean;
};

export type PortalData = {
  name: string;
  expired: boolean;
  templates: PortalTemplateSummary[];
  defaultTemplate: string | null;
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

export type State = {
  hosts: Row[];
  nodes: Row[];
  users: Row[];
  templates: Row[];
  alerts: Row[];
  tasks: Row[];
  workers: Row[];
  origin: string;
};
