import { useEffect, useState, type DragEvent } from "react";
import { Button, Card, Checkbox, Flex, Form, Image, Input, InputNumber, Radio, Segmented, Select, Space, Tooltip, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  DownOutlined,
  HolderOutlined,
  PaperClipOutlined,
  PictureOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { t, tn } from "../shared/i18n";
import { formatPoints, roundPoints } from "../shared/points";
import { changeQuestionType, type QuestionForm, type QuestionType } from "./quizForm";

// A plain number input: antd InputNumber formats 1 as "1.00" and rounds 0.255 on blur,
// while a value with more than 2 decimals must reach the save validation unchanged.
function PointsInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(value === null ? "" : String(value));
  }, [value]);
  return (
    <Input
      className="points-input"
      type="number"
      step="0.01"
      placeholder="1"
      value={text}
      style={{ width: 120 }}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.trim() === "" ? null : Number(event.target.value));
      }}
    />
  );
}

export interface CheckerTemplate {
  name: string;
  code: string;
}

const isImagePath = (value: string) => value.trim().startsWith("/imgs/");

export function QuestionCard({
  question,
  index,
  total,
  collapsed,
  errors,
  dragOver,
  checkerTemplates,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onPickImage,
  onPickFile,
  dragHandlers,
}: {
  question: QuestionForm;
  index: number;
  total: number;
  collapsed: boolean;
  errors: string[];
  dragOver: boolean;
  checkerTemplates: CheckerTemplate[];
  onToggle: () => void;
  onChange: (question: QuestionForm) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onPickImage: (target: "question" | number) => void;
  onPickFile: () => void;
  dragHandlers: {
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}) {
  const set = (patch: Partial<QuestionForm>) => onChange({ ...question, ...patch });
  const points = roundPoints(question.points ?? 1);
  const number = index + 1;

  const setOption = (optionIndex: number, value: string) =>
    set({ options: question.options.map((option, i) => (i === optionIndex ? value : option)) });

  const removeOption = (optionIndex: number) =>
    set({
      options: question.options.filter((_, i) => i !== optionIndex),
      // Shift correct indices after the removed option
      correct: question.correct.filter((i) => i !== optionIndex).map((i) => (i > optionIndex ? i - 1 : i)),
    });

  const toggleCorrect = (optionIndex: number) => {
    if (question.type === "single") set({ correct: [optionIndex] });
    else
      set({
        correct: question.correct.includes(optionIndex)
          ? question.correct.filter((i) => i !== optionIndex)
          : [...question.correct, optionIndex],
      });
  };

  const header = (
    <Flex align="center" gap={8} onClick={onToggle} style={{ cursor: "pointer", minWidth: 0 }}>
      <span
        className="drag-handle"
        title={t("question.drag")}
        draggable
        onClick={(event) => event.stopPropagation()}
        onDragStart={dragHandlers.onDragStart}
        onDragEnd={dragHandlers.onDragEnd}
      >
        <HolderOutlined />
      </span>
      {collapsed ? <RightOutlined /> : <DownOutlined />}
      <span className="question-number">{number}.</span>
      <span className="question-indicators">
        {question.stick_to_the_previous && <span title={t("question.sticky")}>🔗</span>}
        {question.image && <span title={t("question.has_image")}>🖼️</span>}
        {question.file && <span title={t("question.has_file")}>📎</span>}
        {points !== 1 && (
          <span className="points-indicator" title={tn("plural.points", points, { n: formatPoints(points) })}>
            🏆{points}
          </span>
        )}
      </span>
      <Typography.Text ellipsis className="question-preview" type={question.question ? undefined : "secondary"}>
        {question.question || (question.image ? question.image.split("/").pop() : "")}
      </Typography.Text>
    </Flex>
  );

  return (
    <Card
      size="small"
      className={`question-item${collapsed ? " collapsed" : ""}${dragOver ? " drag-over" : ""}`}
      data-testid="question-item"
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      style={errors.length > 0 ? { borderColor: "#ff4d4f" } : undefined}
      title={header}
      extra={
        <Space size={2}>
          {index > 0 && <Button size="small" type="text" icon={<ArrowUpOutlined />} title={t("question.move_up")} onClick={() => onMove(-1)} />}
          {index < total - 1 && (
            <Button size="small" type="text" icon={<ArrowDownOutlined />} title={t("question.move_down")} onClick={() => onMove(1)} />
          )}
          <Button size="small" type="text" danger icon={<DeleteOutlined />} title={t("common.delete")} onClick={onRemove} />
        </Space>
      }
      styles={{ body: collapsed ? { display: "none" } : undefined }}
    >
      <Form layout="vertical" component="div">
        <Form.Item label={t("question.text")}>
          <Input
            className="question-text"
            value={question.question}
            placeholder={t("question.text_placeholder")}
            onChange={(event) => set({ question: event.target.value })}
          />
        </Form.Item>

        <Form.Item label={t("question.image")}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              className="question-image"
              value={question.image}
              placeholder={t("question.image_placeholder")}
              onChange={(event) => set({ image: event.target.value })}
            />
            <Button icon={<PictureOutlined />} title={t("question.choose_image")} onClick={() => onPickImage("question")} />
          </Space.Compact>
          {isImagePath(question.image) && (
            <Image src={question.image} height={120} style={{ marginTop: 8, objectFit: "contain" }} />
          )}
        </Form.Item>

        <Form.Item label={t("question.file")}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              className="question-file"
              value={question.file}
              placeholder={t("question.file_placeholder")}
              onChange={(event) => set({ file: event.target.value })}
            />
            <Button icon={<PaperClipOutlined />} title={t("question.choose_file")} onClick={onPickFile} />
          </Space.Compact>
        </Form.Item>

        <Form.Item label={t("question.type")}>
          <Segmented<QuestionType>
            value={question.type}
            onChange={(type) => onChange(changeQuestionType(question, type))}
            options={[
              { value: "single", label: t("question.type_single") },
              { value: "multiple", label: t("question.type_multiple") },
              { value: "text", label: t("question.type_text") },
            ]}
          />
        </Form.Item>

        {question.type !== "text" ? (
          <>
            <Form.Item label={t("question.options")}>
              <Flex vertical gap={8}>
                {question.options.map((option, optionIndex) => (
                  <Flex key={optionIndex} gap={8} align="center" className="option-item">
                    {question.type === "single" ? (
                      <Radio checked={question.correct.includes(optionIndex)} onChange={() => toggleCorrect(optionIndex)} />
                    ) : (
                      <Checkbox checked={question.correct.includes(optionIndex)} onChange={() => toggleCorrect(optionIndex)} />
                    )}
                    <Input
                      className="option-text"
                      value={option}
                      placeholder={t("question.option_n", { n: optionIndex + 1 })}
                      onChange={(event) => setOption(optionIndex, event.target.value)}
                    />
                    {isImagePath(option) && <Image src={option} height={36} style={{ objectFit: "contain" }} />}
                    <Button
                      icon={<PictureOutlined />}
                      title={t("question.choose_image")}
                      onClick={() => onPickImage(optionIndex)}
                    />
                    <Tooltip title={question.options.length <= 2 ? t("question.min_options") : undefined}>
                      <Button
                        icon={<DeleteOutlined />}
                        disabled={question.options.length <= 2}
                        onClick={() => removeOption(optionIndex)}
                      />
                    </Tooltip>
                  </Flex>
                ))}
                <div>
                  <Button icon={<PlusOutlined />} onClick={() => set({ options: [...question.options, ""] })}>
                    {t("question.add_option")}
                  </Button>
                </div>
              </Flex>
            </Form.Item>
            {question.type === "multiple" && (
              <Form.Item label={t("question.min_correct")}>
                <InputNumber
                  min={1}
                  precision={0}
                  placeholder={t("question.all_correct")}
                  value={question.min_correct}
                  onChange={(value) => set({ min_correct: value })}
                  style={{ width: 160 }}
                />
              </Form.Item>
            )}
          </>
        ) : (
          <>
            <Form.Item label={t("question.default_value")}>
              <Input.TextArea
                className="code-editor"
                autoSize={{ minRows: 2 }}
                value={question.default_value}
                placeholder={t("question.default_value_placeholder")}
                onChange={(event) => set({ default_value: event.target.value })}
              />
            </Form.Item>
            <Form.Item label={t("question.correct_value")}>
              <Input.TextArea
                className="code-editor"
                autoSize={{ minRows: 2 }}
                value={question.correct_value}
                placeholder={t("question.correct_value_placeholder")}
                onChange={(event) => set({ correct_value: event.target.value })}
              />
            </Form.Item>
            <Form.Item label={t("question.checker")} extra={t("question.checker_hint")}>
              <Flex vertical gap={8}>
                <Select
                  placeholder={t("question.choose_template")}
                  value={null}
                  options={checkerTemplates.map((template) => ({ value: template.code, label: template.name }))}
                  onChange={(code: string) => set({ checker: code })}
                  notFoundContent={t("question.no_templates")}
                />
                <Input.TextArea
                  className="code-editor checker-input"
                  autoSize={{ minRows: 4 }}
                  value={question.checker}
                  spellCheck={false}
                  onChange={(event) => set({ checker: event.target.value })}
                />
              </Flex>
            </Form.Item>
          </>
        )}

        <Flex wrap gap={24} align="center">
          <Form.Item label={t("question.points")} style={{ marginBottom: 0 }}>
            <PointsInput value={question.points} onChange={(points) => set({ points })} />
          </Form.Item>
          <Checkbox
            checked={question.stick_to_the_previous}
            disabled={index === 0}
            onChange={(event) => set({ stick_to_the_previous: event.target.checked })}
          >
            {t("question.stick")}
          </Checkbox>
        </Flex>

        {errors.length > 0 && (
          <Typography.Text type="danger" style={{ display: "block", marginTop: 8 }} data-testid="question-errors">
            {errors.join("; ")}
          </Typography.Text>
        )}
      </Form>
    </Card>
  );
}
