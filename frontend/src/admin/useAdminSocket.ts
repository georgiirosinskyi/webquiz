import { useEffect, useRef } from "react";
import type { AdminMessage } from "./types";

const RECONNECT_DELAY_MS = 5000;

// Connects to /ws/admin and passes every message to `onMessage`;
// reconnects 5 s after the connection drops.
export function useAdminSocket(onMessage: (message: AdminMessage) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let stopped = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/admin`);
      socket.onmessage = (event) => {
        try {
          handler.current(JSON.parse(event.data) as AdminMessage);
        } catch (error) {
          console.error("Error parsing admin WebSocket message:", error);
        }
      };
      socket.onclose = () => {
        if (!stopped) timer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
