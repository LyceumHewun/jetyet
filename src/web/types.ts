export type Row = Record<string, any>;

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
