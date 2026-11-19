import type { MouseEvent, ReactNode } from "react";
import type { Route, Section, State } from "../types";

export type ViewContext = {
  state: State;
  route: Route;
  navigate: (next: Route, replace?: boolean) => void;
  goBackToRoot: (section: Section) => void;
  linkProps: (
    next: Route,
    replace?: boolean,
  ) => {
    href: string;
    onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
  };
  runAction: (fn: () => Promise<any>, message?: string) => Promise<any>;
  refresh: (manual?: boolean) => Promise<void>;
  confirmModal: (node: ReactNode) => void;
  closeModal: () => void;
  notify: (msg: string) => void;
  reportError: (msg: string) => void;
  workerOnline: (name: string) => boolean;
};
