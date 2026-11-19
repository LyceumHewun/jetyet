export type Row = Record<string, any>;

export type Section =
  | "overview"
  | "vps"
  | "nodes"
  | "users"
  | "templates"
  | "operations"
  | "alerts"
  | "onboard";

export type Route = {
  section: Section;
  id?: string;
  sub?: string;
  mode?: "new" | "archive";
};

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
