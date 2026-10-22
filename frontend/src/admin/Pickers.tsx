import { useEffect, useState } from "react";
import { App, Card, Empty, List, Modal, Spin, Typography } from "antd";
import { apiGet } from "../shared/api";
import { formatFileSize } from "../shared/format";

interface ImageInfo {
  filename: string;
  path: string;
  folder: string;
}

interface AttachInfo {
  filename: string;
  path: string;
  size: number;
}

function useList<T>(open: boolean, url: string, key: string) {
  const { message } = App.useApp();
  const [items, setItems] = useState<T[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setItems(null);
    apiGet<Record<string, T[]>>(url)
      .then((result) => {
        if (result.ok) setItems(result.data[key] || []);
        else {
          message.error(result.data.error || "Не вдалося завантажити список");
          setItems([]);
        }
      })
      .catch((error) => {
        message.error(`Помилка завантаження: ${error.message}`);
        setItems([]);
      });
  }, [open, url, key, message]);
  return items;
}

// Images from quizzes/imgs, grouped by folder.
export function ImagePicker({
  open,
  onSelect,
  onClose,
}: {
  open: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const images = useList<ImageInfo>(open, "/api/admin/list-images", "images");
  const groups = new Map<string, ImageInfo[]>();
  (images || []).forEach((image) => {
    const folder = image.folder || "imgs";
    groups.set(folder, [...(groups.get(folder) || []), image]);
  });

  return (
    <Modal open={open} title="📷 Вибрати Зображення" onCancel={onClose} footer={null} width={900} destroyOnHidden>
      {images === null ? (
        <Spin style={{ display: "block", padding: 40 }} />
      ) : images.length === 0 ? (
        <Empty
          description={
            <>
              Зображення не знайдені в директорії quizzes/imgs
              <br />
              <Typography.Text type="secondary">Додайте файли зображень до quizzes/imgs, щоб побачити їх тут</Typography.Text>
            </>
          }
        />
      ) : (
        [...groups.entries()].map(([folder, folderImages]) => (
          <div key={folder} style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary" strong>
              📁 {folder}/
            </Typography.Text>
            <div className="image-grid">
              {folderImages.map((image) => (
                <Card
                  key={image.path}
                  hoverable
                  size="small"
                  title={null}
                  onClick={() => onSelect(image.path)}
                  cover={<img src={image.path} alt={image.filename} loading="lazy" className="image-grid-thumb" />}
                  styles={{ body: { padding: 6 } }}
                >
                  <Typography.Text ellipsis={{ tooltip: image.filename }} style={{ fontSize: 12 }}>
                    {image.filename}
                  </Typography.Text>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </Modal>
  );
}

// Downloadable attachments from quizzes/attach.
export function FilePicker({
  open,
  onSelect,
  onClose,
}: {
  open: boolean;
  onSelect: (filename: string) => void;
  onClose: () => void;
}) {
  const files = useList<AttachInfo>(open, "/api/admin/list-files", "files");
  return (
    <Modal open={open} title="📎 Вибрати Файл" onCancel={onClose} footer={null} width={600} destroyOnHidden>
      {files === null ? (
        <Spin style={{ display: "block", padding: 40 }} />
      ) : (
        <List
          dataSource={files}
          locale={{ emptyText: <Empty description="Файли не знайдені в директорії quizzes/attach" /> }}
          renderItem={(file) => (
            <List.Item
              className="picker-row"
              onClick={() => onSelect(file.path.replace(/^\/attach\//, ""))}
              extra={<Typography.Text type="secondary">{formatFileSize(file.size)}</Typography.Text>}
            >
              📄 {file.filename}
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
}
