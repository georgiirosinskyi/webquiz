import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { emptyState, reducer, type ServerMessage } from "./stats";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 1000;
const KEEP_ALIVE_MS = 30000;

export type ConnectionStatus =
  | { kind: "connected" }
  | { kind: "reconnecting"; attempt: number; delaySeconds: number }
  | { kind: "failed" };

// Connects to /ws/live-stats, reconnects with exponential backoff
// (1s, 2s, 4s, 8s, 16s) and gives up after MAX_RECONNECT_ATTEMPTS.
export function useLiveStatsSocket() {
  const [state, dispatch] = useReducer(reducer, emptyState);
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "connected" });
  const [generation, setGeneration] = useState(0);
  const attempts = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/live-stats`);

      socket.onopen = () => {
        attempts.current = 0;
        setStatus({ kind: "connected" });
      };
      socket.onmessage = (event) => {
        try {
          dispatch(JSON.parse(event.data) as ServerMessage);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        if (attempts.current >= MAX_RECONNECT_ATTEMPTS) {
          setStatus({ kind: "failed" });
          return;
        }
        attempts.current++;
        const delay = RECONNECT_DELAY_MS * 2 ** (attempts.current - 1);
        setStatus({ kind: "reconnecting", attempt: attempts.current, delaySeconds: delay / 1000 });
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    const keepAlive = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, KEEP_ALIVE_MS);

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(keepAlive);
      socket?.close();
    };
  }, [generation]);

  // Starts over after the attempts ran out.
  const reconnect = useCallback(() => {
    attempts.current = 0;
    setStatus({ kind: "connected" });
    setGeneration((value) => value + 1);
  }, []);

  return { state, status, reconnect, maxAttempts: MAX_RECONNECT_ATTEMPTS };
}
