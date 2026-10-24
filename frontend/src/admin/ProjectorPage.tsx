import { useEffect, useState } from "react";
import { Button, QRCode } from "antd";
import { FullscreenOutlined } from "@ant-design/icons";
import { t } from "../shared/i18n";
import { addressFontSize, displayUrl, projectorUrls } from "./projector";

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

// The access addresses for a projector or a TV: huge text and QR codes, readable from the back rows.
// A static page: it shows what was true when it was opened (open it again after a change).
export function ProjectorPage({
  urls,
  publicUrl,
  quizTitle,
}: {
  urls: string[];
  publicUrl?: string | null;
  quizTitle?: string | null;
}) {
  const { width, height } = useWindowSize();
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const items = projectorUrls(urls, publicUrl);
  const fontSize = addressFontSize(items.length, width);
  // Side by side, each code as large as the window allows
  const qrSize = Math.round(Math.max(160, Math.min(height * 0.42, (width * 0.8) / Math.max(items.length, 1))));

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
      {items.length > 0 ? (
        <div className="projector-urls">
          {items.map((item) => (
            <div key={item.url} className={`projector-url${item.public ? " public" : ""}`} data-testid="projector-url">
              <QRCode value={item.url} size={qrSize} bordered={false} errorLevel="M" />
              <div className="projector-address" style={{ fontSize }}>
                {displayUrl(item.url)}
              </div>
              {item.public && (
                <div className="projector-note" style={{ fontSize: Math.round(fontSize * 0.35) }}>
                  {t("projector.from_internet")}
                </div>
              )}
            </div>
          ))}
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
