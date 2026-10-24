import { useRef, useState } from "react";
import { Alert, App, Button, Card, Checkbox, ColorPicker, Flex, Form, Input, Segmented, Select, Space, Typography } from "antd";
import type { Color } from "antd/es/color-picker";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  PictureOutlined,
  PlusOutlined,
  RightOutlined,
  SaveOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { ImagePicker } from "../admin/Pickers";
import { apiSend, saveBlob } from "../shared/api";
import { t } from "../shared/i18n";
import { DEFAULT_BACKGROUND_COLOR } from "../shared/background";
import { configToForm, formToConfig, mergeImportedConfig, type ConfigData, type ConfigFormValues } from "./types";

type View = "form" | "yaml";
type Feedback = { type: "success" | "error"; text: string; details?: string[] } | null;

// Colors offered next to the picker: the dark default and a few calm ones
const BACKGROUND_PRESETS = [
  DEFAULT_BACKGROUND_COLOR,
  "#141414",
  "#0f2a44",
  "#1b3a2f",
  "#3b1f3a",
  "#f5f5f5",
  "#e6f4ff",
];

// How the quiz page background looks; the admin page serves /imgs/ too, so the path works as is
function BackgroundPreview({ mode, color, image }: { mode: string; color: string; image: string }) {
  const url = mode === "image" ? image.trim() : "";
  return (
    <div
      className="background-preview"
      data-testid="cfg-background-preview"
      style={{
        backgroundColor: color || DEFAULT_BACKGROUND_COLOR,
        backgroundImage: url ? `url(${JSON.stringify(url)})` : undefined,
      }}
    >
      <div className="background-preview-card" />
    </div>
  );
}

// Config tab: structured form (JSON partial update) or the raw YAML.
export function ConfigEditor({
  configPath,
  initialContent,
  initialData,
  onSaved,
}: {
  configPath: string;
  initialContent: string;
  initialData: ConfigData | null;
  onSaved?: (content: string, data: ConfigData | null) => void;
}) {
  const { modal } = App.useApp();
  const [form] = Form.useForm<ConfigFormValues>();
  const [view, setView] = useState<View>("form");
  // Fields (Form.List keys) whose values are shown; the lists are closed until opened, they can be long
  const [openOptions, setOpenOptions] = useState<Set<number>>(new Set());
  const toggleOptions = (key: number) =>
    setOpenOptions((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [yaml, setYaml] = useState(initialContent);
  const [formDirty, setFormDirty] = useState(false);
  const [yamlDirty, setYamlDirty] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const backgroundMode = Form.useWatch("background_mode", form) || "color";
  const backgroundColor = Form.useWatch("background_color", form) || DEFAULT_BACKGROUND_COLOR;
  const backgroundImage = Form.useWatch("background_image", form) || "";

  const switchView = (next: View) => {
    if (next === view) return;
    if (view === "form" ? formDirty : yamlDirty) {
      modal.confirm({
        title: t("settings.unsaved"),
        onOk: () => setView(next),
      });
    } else {
      setView(next);
    }
  };

  // Settings of the form as a file (never the master key, server or paths), and back into the form
  const importInput = useRef<HTMLInputElement>(null);

  const exportSettings = async () => {
    setFeedback(null);
    try {
      const result = await apiSend<{ content: string; filename: string }>("POST", "/api/admin/config/export", {
        data: formToConfig(form.getFieldsValue(true)),
      });
      if (result.ok) {
        saveBlob(new Blob([result.data.content], { type: "application/x-yaml" }), result.data.filename);
      } else {
        setFeedback({ type: "error", text: result.data.error || t("settings.export_failed"), details: result.data.errors });
      }
    } catch (error) {
      setFeedback({ type: "error", text: t("common.error", { error: (error as Error).message }) });
    }
  };

  const importSettings = async (file: File) => {
    setFeedback(null);
    try {
      const result = await apiSend<{ data: Partial<ConfigData>; ignored: string[] }>("POST", "/api/admin/config/import", {
        content: await file.text(),
      });
      if (!result.ok) {
        setFeedback({ type: "error", text: result.data.error || t("settings.import_failed"), details: result.data.errors });
        return;
      }
      // Into the form only: the admin looks at it and saves
      form.setFieldsValue(mergeImportedConfig(form.getFieldsValue(true), result.data.data));
      setFormDirty(true);
      setFeedback({
        type: "success",
        text: t("settings.imported", { name: file.name }),
        details: result.data.ignored.length > 0 ? [t("settings.import_ignored", { keys: result.data.ignored.join(", ") })] : undefined,
      });
    } catch (error) {
      setFeedback({ type: "error", text: t("common.error", { error: (error as Error).message }) });
    }
  };

  const save = async () => {
    setFeedback(null);
    setSaving(true);
    try {
      const body = view === "form" ? { data: formToConfig(form.getFieldsValue(true)) } : { content: yaml };
      const result = await apiSend<{ message: string; config_content?: string; config_data?: ConfigData }>(
        "PUT",
        "/api/admin/config",
        body,
      );
      if (result.ok) {
        setFeedback({ type: "success", text: result.data.message });
        // Both views show the saved config
        if (result.data.config_content !== undefined) setYaml(result.data.config_content);
        if (result.data.config_data) form.setFieldsValue(configToForm(result.data.config_data));
        setFormDirty(false);
        setYamlDirty(false);
        if (result.data.config_content !== undefined) onSaved?.(result.data.config_content, result.data.config_data || null);
      } else {
        setFeedback({
          type: "error",
          text: result.data.error || t("settings.save_failed"),
          details: result.data.errors,
        });
      }
    } catch (error) {
      setFeedback({ type: "error", text: t("common.error", { error: (error as Error).message }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text>
        <strong>{t("settings.config_file")}</strong> <Typography.Text type="secondary">{configPath}</Typography.Text>
      </Typography.Text>

      <Flex justify="space-between" align="center" gap={8} wrap>
        <Segmented<View>
          value={view}
          onChange={switchView}
          options={[
            { value: "form", label: t("settings.form") },
            { value: "yaml", label: "YAML" },
          ]}
        />
        {view === "form" && (
          <Space wrap>
            <Button icon={<UploadOutlined />} onClick={exportSettings} data-testid="cfg-export">
              {t("settings.export")}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => importInput.current?.click()} data-testid="cfg-import">
              {t("settings.import")}
            </Button>
            <input
              ref={importInput}
              type="file"
              accept=".yaml,.yml"
              hidden
              data-testid="cfg-import-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // The same file can be chosen again
                event.target.value = "";
                if (file) importSettings(file);
              }}
            />
          </Space>
        )}
      </Flex>

      <div style={{ display: view === "form" ? undefined : "none" }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={configToForm(initialData)}
          onValuesChange={() => setFormDirty(true)}
        >
          <Card size="small" title={t("settings.general")} style={{ marginBottom: 16 }}>
            <Form.Item
              name="language"
              label={t("settings.language")}
              extra={t("settings.language_hint")}
            >
              <Select
                id="cfg-language"
                style={{ width: "100%", maxWidth: 320 }}
                options={[
                  { value: "uk", label: "Українська" },
                  { value: "en", label: "English" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="extra_answers_with_users_csv"
              valuePropName="checked"
              extra={t("settings.extra_csv_hint")}
            >
              <Checkbox id="cfg-extra-answers-with-users-csv">{t("settings.extra_csv")}</Checkbox>
            </Form.Item>
            <Form.Item
              name="question_navigation"
              valuePropName="checked"
              extra={t("settings.navigation_hint")}
              style={{ marginBottom: 0 }}
            >
              <Checkbox id="cfg-question-navigation">{t("settings.navigation")}</Checkbox>
            </Form.Item>
          </Card>

          <Card size="small" title={t("settings.background")} style={{ marginBottom: 16 }} data-testid="cfg-background">
            <Flex gap={24} wrap align="flex-start">
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <Form.Item name="background_mode" label={t("settings.background_mode")}>
                  <Segmented
                    id="cfg-background-mode"
                    options={[
                      { value: "color", label: t("settings.background_color_mode") },
                      { value: "image", label: t("settings.background_image_mode") },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="background_color"
                  label={backgroundMode === "image" ? t("settings.color_under_image") : t("settings.color")}
                  getValueFromEvent={(color: Color) => color.toHexString()}
                >
                  <ColorPicker
                    showText
                    disabledAlpha
                    presets={[{ label: t("settings.suggested"), colors: BACKGROUND_PRESETS }]}
                    data-testid="cfg-background-color"
                  />
                </Form.Item>
                {backgroundMode === "image" && (
                  <Form.Item
                    label={t("settings.image")}
                    extra={t("settings.image_hint")}
                    style={{ marginBottom: 0 }}
                  >
                    <Space.Compact style={{ width: "100%", maxWidth: 480 }}>
                      <Form.Item name="background_image" noStyle>
                        <Input id="cfg-background-image" placeholder="/imgs/background.jpg" allowClear />
                      </Form.Item>
                      <Button icon={<PictureOutlined />} onClick={() => setPickingImage(true)}>
                        {t("settings.choose")}
                      </Button>
                    </Space.Compact>
                  </Form.Item>
                )}
              </div>
              <BackgroundPreview mode={backgroundMode} color={backgroundColor} image={backgroundImage} />
            </Flex>
          </Card>

          <Card size="small" title={t("settings.registration")}>
            <Form.Item name="approve" valuePropName="checked">
              <Checkbox id="cfg-reg-approve">{t("settings.approve")}</Checkbox>
            </Form.Item>
            <Form.Item name="username_label" label={t("settings.username_label")}>
              <Input id="cfg-reg-username-label" placeholder={t("settings.username_label_placeholder")} style={{ maxWidth: 400 }} />
            </Form.Item>
            <Form.Item
              label={t("settings.fields")}
              extra={`${t("settings.fields_hint")} ${t("settings.field_options_hint")}`}
              style={{ marginBottom: 0 }}
            >
              <Form.List name="fields">
                {(fields, { add, remove }) => (
                  <Flex vertical gap={8} data-testid="cfg-reg-fields-list">
                    {fields.map((field) => (
                      <Flex key={field.key} vertical gap={6} data-testid="cfg-reg-field">
                        <Flex gap={8} align="center">
                          <Form.Item name={[field.name, "enabled"]} valuePropName="checked" noStyle>
                            <Checkbox title={t("settings.field_toggle")} />
                          </Form.Item>
                          <Form.Item
                            noStyle
                            shouldUpdate={(prev, next) =>
                              prev.fields?.[field.name]?.enabled !== next.fields?.[field.name]?.enabled
                            }
                          >
                            {() => (
                              <Form.Item name={[field.name, "name"]} noStyle>
                                <Input
                                  className="cfg-reg-field-name"
                                  placeholder={t("settings.field_name")}
                                  style={{
                                    maxWidth: 400,
                                    textDecoration:
                                      form.getFieldValue(["fields", field.name, "enabled"]) === false
                                        ? "line-through"
                                        : undefined,
                                  }}
                                />
                              </Form.Item>
                            )}
                          </Form.Item>
                          <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} title={t("settings.field_remove")} />
                        </Flex>
                        {/* Values to choose from, one per row in their order: none = the field takes any text */}
                        <Form.List name={[field.name, "options"]}>
                          {(options, { add: addOption, remove: removeOption, move }) => (
                            <Flex vertical gap={4} className="field-options" data-testid="cfg-reg-field-options">
                              <div>
                                <Button
                                  size="small"
                                  type="link"
                                  icon={openOptions.has(field.key) ? <DownOutlined /> : <RightOutlined />}
                                  onClick={() => toggleOptions(field.key)}
                                  className="field-options-toggle"
                                  data-testid="cfg-reg-options-toggle"
                                >
                                  {t("settings.field_options", { count: options.length })}
                                </Button>
                              </div>
                              {openOptions.has(field.key) && options.map((option, index) => (
                                <Flex key={option.key} gap={4} align="center">
                                  <Typography.Text type="secondary" className="field-option-number">
                                    {index + 1}.
                                  </Typography.Text>
                                  <Form.Item name={option.name} noStyle>
                                    <Input className="cfg-reg-field-option" style={{ maxWidth: 320 }} />
                                  </Form.Item>
                                  <Button
                                    type="text"
                                    icon={<ArrowUpOutlined />}
                                    disabled={index === 0}
                                    onClick={() => move(index, index - 1)}
                                    title={t("settings.option_up")}
                                    data-testid="cfg-reg-option-up"
                                  />
                                  <Button
                                    type="text"
                                    icon={<ArrowDownOutlined />}
                                    disabled={index === options.length - 1}
                                    onClick={() => move(index, index + 1)}
                                    title={t("settings.option_down")}
                                    data-testid="cfg-reg-option-down"
                                  />
                                  <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => removeOption(option.name)}
                                    title={t("settings.option_remove")}
                                    data-testid="cfg-reg-option-remove"
                                  />
                                </Flex>
                              ))}
                              {openOptions.has(field.key) && (
                                <div>
                                  <Button
                                    size="small"
                                    type="dashed"
                                    icon={<PlusOutlined />}
                                    onClick={() => addOption("")}
                                    data-testid="cfg-reg-add-option"
                                  >
                                    {t("settings.add_option")}
                                  </Button>
                                </div>
                              )}
                            </Flex>
                          )}
                        </Form.List>
                      </Flex>
                    ))}
                    <div>
                      <Button icon={<PlusOutlined />} onClick={() => add({ name: "", enabled: true, options: [] })}>
                        {t("settings.add_field")}
                      </Button>
                    </div>
                  </Flex>
                )}
              </Form.List>
            </Form.Item>
          </Card>
        </Form>
      </div>

      {view === "yaml" && (
        <Input.TextArea
          id="config-editor"
          className="code-editor"
          value={yaml}
          onChange={(event) => {
            setYaml(event.target.value);
            setYamlDirty(true);
          }}
          autoSize={{ minRows: 20, maxRows: 40 }}
          spellCheck={false}
        />
      )}

      <ImagePicker
        open={pickingImage}
        onClose={() => setPickingImage(false)}
        onSelect={(path) => {
          form.setFieldValue("background_image", path);
          setFormDirty(true);
          setPickingImage(false);
        }}
      />

      <Flex justify="center">
        <Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} onClick={save}>
          {t("settings.save")}
        </Button>
      </Flex>

      {feedback && (
        <Alert
          type={feedback.type}
          showIcon
          title={feedback.text}
          description={
            feedback.details?.length ? (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {feedback.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : undefined
          }
        />
      )}
    </Space>
  );
}
