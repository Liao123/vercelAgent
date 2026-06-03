import type { DetailedHTMLProps, HTMLAttributes } from "react";

type WebviewProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  src?: string;
  allowpopups?: boolean | "";
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
