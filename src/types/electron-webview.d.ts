import type { DetailedHTMLProps, HTMLAttributes } from "react";

type WebviewProps = Omit<
  DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>,
  "allowpopups"
> & {
  src?: string;
  useragent?: string;
  allowpopups?: "" | true;
  partition?: string;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewProps;
    }
  }
}

export {};
