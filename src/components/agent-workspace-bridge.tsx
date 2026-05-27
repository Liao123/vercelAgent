"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentEvent } from "@/agent/types";

export type TraceRestorePayload = {
  traceId: string;
  taskId: string;
  events: AgentEvent[];
  userRequest?: string;
  taskSummary?: string | null;
};

type HistoryFocus = {
  traceId?: string;
  taskId?: string;
};

type PanelHandlers = {
  restoreFromTrace: (payload: TraceRestorePayload) => void;
};

type AgentWorkspaceBridgeValue = {
  currentTaskId: string | null;
  currentTraceId: string | null;
  setSession: (taskId: string | null, traceId: string | null) => void;
  registerPanel: (handlers: PanelHandlers | null) => void;
  restoreToPanel: (payload: TraceRestorePayload) => void;
  openHistory: (focus?: HistoryFocus) => void;
  historyFocus: HistoryFocus | null;
  clearHistoryFocus: () => void;
};

const AgentWorkspaceBridgeContext =
  createContext<AgentWorkspaceBridgeValue | null>(null);

export function AgentWorkspaceBridgeProvider({
  children,
  onOpenHistory,
  onAfterRestore,
}: {
  children: ReactNode;
  onOpenHistory: () => void;
  onAfterRestore?: () => void;
}) {
  const panelRef = useRef<PanelHandlers | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentTraceId, setCurrentTraceId] = useState<string | null>(null);
  const [historyFocus, setHistoryFocus] = useState<HistoryFocus | null>(null);

  const registerPanel = useCallback((handlers: PanelHandlers | null) => {
    panelRef.current = handlers;
  }, []);

  const setSession = useCallback((taskId: string | null, traceId: string | null) => {
    setCurrentTaskId(taskId);
    setCurrentTraceId(traceId);
  }, []);

  const restoreToPanel = useCallback(
    (payload: TraceRestorePayload) => {
      panelRef.current?.restoreFromTrace(payload);
      setCurrentTaskId(payload.taskId);
      setCurrentTraceId(payload.traceId);
      setHistoryFocus(null);
      onAfterRestore?.();
    },
    [onAfterRestore],
  );

  const openHistory = useCallback(
    (focus?: HistoryFocus) => {
      setHistoryFocus(focus ?? null);
      onOpenHistory();
    },
    [onOpenHistory],
  );

  const clearHistoryFocus = useCallback(() => {
    setHistoryFocus(null);
  }, []);

  const value = useMemo<AgentWorkspaceBridgeValue>(
    () => ({
      currentTaskId,
      currentTraceId,
      setSession,
      registerPanel,
      restoreToPanel,
      openHistory,
      historyFocus,
      clearHistoryFocus,
    }),
    [
      clearHistoryFocus,
      currentTaskId,
      currentTraceId,
      historyFocus,
      openHistory,
      registerPanel,
      restoreToPanel,
      setSession,
    ],
  );

  return (
    <AgentWorkspaceBridgeContext.Provider value={value}>
      {children}
    </AgentWorkspaceBridgeContext.Provider>
  );
}

export function useAgentWorkspaceBridge(): AgentWorkspaceBridgeValue | null {
  return useContext(AgentWorkspaceBridgeContext);
}
