import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { apiGet } from "../shared/api";
import { t } from "../shared/i18n";
import { TRANSFER_STATUS_TEXT, type TransferState } from "./types";

const TRANSFER_POLL_MS = 5000;

// State of sending to other servers (GET /api/admin/transfer), polled while the section is open;
// tells the admin when the other server answers an offer.
export function useTransfer(): [TransferState, () => void] {
  const { message } = App.useApp();
  const [transfer, setTransfer] = useState<TransferState>({ available: false, name: null, outgoing: [] });
  const offerStatuses = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const result = await apiGet<TransferState>("/api/admin/transfer");
      if (!result.ok) return;
      for (const offer of result.data.outgoing) {
        if (offerStatuses.current[offer.id] === "waiting" && offer.status !== "waiting") {
          const status = TRANSFER_STATUS_TEXT[offer.status];
          const text = `${offer.to}: ${status ? t(status) : offer.status}`;
          if (offer.status === "accepted") message.success(text);
          else message.error(text);
        }
        offerStatuses.current[offer.id] = offer.status;
      }
      setTransfer(result.data);
    } catch {
      // The next poll tries again
    }
  }, [message]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, TRANSFER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return [transfer, load];
}
