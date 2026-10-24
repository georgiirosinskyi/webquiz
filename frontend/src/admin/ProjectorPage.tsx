import { useEffect, useState } from "react";
import { Button, QRCode } from "antd";
import { FullscreenOutlined } from "@ant-design/icons";
import { t } from "../shared/i18n";
import { addressFontSize, displayUrl } from "./projector";

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

// The local network address for a projector or a TV (a class is usually on the local network):
// huge text and a QR code, readable from the back rows. The server picks one address
// (pick_projector_ip). A static page: it shows what was true when it was opened.
export function ProjectorPage({ url, quizTitle }: { url?: string | null; quizTitle?: string | null }) {
  const { width, height } = useWindowSize();
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const fontSize = addressFontSize(width);
  // The code as large as the window allows next to the texts
  const qrSize = Math.round(Math.max(160, Math.min(height * 0.45, width * 0.8)));

  useEffect(() => {
    document.title = `${t("projector.title")} · WebQuiz`;
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  return (
    <div className="projector" data-testid="projector">
      {quizTitle && (
        <div className="projector-quiz" style={{ fontSize: Math.round(fontSize * 0.5) }}>
          {quizTitle}
        </div>
      )}
      <div className="projector-call" style={{ fontSize: Math.round(fontSize * 0.45) }}>
        {t("projector.open_in_browser")}
      </div>
      {url ? (
        <div className="projector-url" data-testid="projector-url">
          <QRCode value={url} size={qrSize} bordered={false} errorLevel="M" />
          <div className="projector-address" style={{ fontSize }}>
            {displayUrl(url)}
          </div>
        </div>
      ) : (
        <div className="projector-empty" style={{ fontSize: Math.round(fontSize * 0.5) }} data-testid="projector-empty">
          {t("access.no_interfaces")}
        </div>
      )}
      {!fullscreen && (
        <Button
          className="projector-fullscreen"
          size="large"
          icon={<FullscreenOutlined />}
          onClick={() => document.documentElement.requestFullscreen?.()}
          data-testid="projector-fullscreen"
        >
          {t("projector.fullscreen")}
        </Button>
      )}
    </div>
  );
}
