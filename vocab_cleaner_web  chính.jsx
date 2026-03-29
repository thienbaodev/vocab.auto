import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  FileText,
  Download,
  Sparkles,
  FileUp,
  CheckCircle2,
  AlertCircle,
  Copy,
  RotateCcw,
  ShieldCheck,
  Wand2,
  ScanText,
  Crown,
  ChevronRight,
  ClipboardPaste,
  RefreshCcw,
  Phone,
  Mail,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import { Document, Packer, Paragraph } from "docx";

if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  const version = pdfjsLib.version || "4.10.38";
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const VI_ACCENT_REGEX = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
const VI_WORD_START_REGEX = /\s+\S*[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]\S*/i;
const POS_MARKER_REGEX = /\b(n|v|adj|adv|prep|phr|idiom|vt|vi|noun|verb|adjective|adverb)\b\.?/i;
const IPA_REGEX = /\/.+?\//;
const VI_HINT_PATTERNS = [
  /\bnghĩa\b/i,
  /\bdịch\b/i,
  /\btừ bỏ\b/i,
  /\bhoàn thành\b/i,
  /\bbắt đầu\b/i,
  /\bkết thúc\b/i,
  /\bquan trọng\b/i,
  /\bmang tính\b/i,
  /\bruồng bỏ\b/i,
  /\bchăm sóc\b/i,
  /\bđịnh nghĩa\b/i,
  /\bgiải thích\b/i,
  /\btiếp tục\b/i,
  /\bcẩn thận\b/i,
  /\bchậm\b/i,
  /\bnhanh\b/i,
  /\bđúng\b/i,
  /\bsai\b/i,
  /\bđẹp\b/i,
  /\bxấu\b/i,
  /\btò mò\b/i,
];

function normalizeLineSpaces(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizeTextStructure(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeLineSpaces(line));

  const output = [];
  let previousBlank = false;

  for (const line of lines) {
    if (line) {
      output.push(line);
      previousBlank = false;
    } else if (!previousBlank) {
      output.push("");
      previousBlank = true;
    }
  }

  while (output.length && output[0] === "") output.shift();
  while (output.length && output[output.length - 1] === "") output.pop();
  return output.join("\n");
}

function hasVietnameseSignal(text) {
  if (!text) return false;
  if (VI_ACCENT_REGEX.test(text)) return true;
  return VI_HINT_PATTERNS.some((pattern) => pattern.test(text));
}

function looksMostlyEnglish(text) {
  if (!text) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const viLetters = (text.match(/[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi) || []).length;
  return letters > 0 && letters >= Math.max(1, viLetters * 2);
}

function stripVietnameseParentheses(text) {
  let output = text;

  output = output.replace(/\(([^()]*)\)/g, (full, inner) => {
    if (hasVietnameseSignal(inner) && !IPA_REGEX.test(inner) && !POS_MARKER_REGEX.test(inner.trim())) {
      return "";
    }
    return full;
  });

  output = output.replace(/\[([^\[\]]*)\]/g, (full, inner) => {
    if (hasVietnameseSignal(inner)) {
      return "";
    }
    return full;
  });

  return normalizeLineSpaces(output);
}

function removeTrailingTranslation(text, aggressive) {
  const separators = ["\t", " → ", " => ", " = ", " – ", " — ", " - ", ": ", " ; ", " | "];

  for (const separator of separators) {
    if (!text.includes(separator)) continue;
    const parts = text.split(separator);
    if (parts.length < 2) continue;

    const left = normalizeLineSpaces(parts[0]);
    const right = normalizeLineSpaces(parts.slice(1).join(separator));

    if (hasVietnameseSignal(right) && looksMostlyEnglish(left)) {
      return left;
    }
  }

  const genericSplit = text.match(/^(.{1,180}?)\s*[:：-]\s*(.+)$/);
  if (genericSplit) {
    const left = normalizeLineSpaces(genericSplit[1]);
    const right = normalizeLineSpaces(genericSplit[2]);
    if (hasVietnameseSignal(right) && looksMostlyEnglish(left)) {
      return left;
    }
  }

  const viStartMatch = text.match(VI_WORD_START_REGEX);
  if (viStartMatch && typeof viStartMatch.index === "number" && viStartMatch.index > 0) {
    const left = normalizeLineSpaces(text.slice(0, viStartMatch.index).replace(/[,:;\-–—|]+$/, ""));
    const right = normalizeLineSpaces(text.slice(viStartMatch.index));
    if (looksMostlyEnglish(left) && (aggressive || hasVietnameseSignal(right))) {
      return left;
    }
  }

  return normalizeLineSpaces(text);
}

function stripTranslationLine(line, aggressive) {
  if (!line.trim()) return "";

  let working = stripVietnameseParentheses(line)
    .replace(/[•▪◦◆◇▶►★☆✓✔]/g, "")
    .replace(/^\d+[\.)]\s*/, "")
    .trim();

  working = removeTrailingTranslation(working, aggressive);

  if (aggressive && hasVietnameseSignal(working) && !looksMostlyEnglish(working)) {
    return "";
  }

  return normalizeLineSpaces(working);
}

function cleanVocabularyText(text, aggressive) {
  const lines = normalizeTextStructure(text).split("\n");
  const cleaned = [];

  for (const line of lines) {
    const value = stripTranslationLine(line, aggressive);
    if (!value) {
      if (cleaned[cleaned.length - 1] !== "") cleaned.push("");
      continue;
    }

    if (cleaned[cleaned.length - 1] !== value) {
      cleaned.push(value);
    }
  }

  return normalizeTextStructure(cleaned.join("\n"));
}

async function extractTextFromDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeTextStructure(result.value || "");
}

function buildPageLines(items) {
  const prepared = items
    .map((item) => ({
      text: item?.str || "",
      x: item?.transform?.[4] || 0,
      y: item?.transform?.[5] || 0,
      width: item?.width || 0,
    }))
    .filter((item) => item.text.trim());

  prepared.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 2.5) return b.y - a.y;
    return a.x - b.x;
  });

  const lines = [];
  for (const item of prepared) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine || Math.abs(lastLine.y - item.y) > 2.5) {
      lines.push({ y: item.y, items: [item] });
    } else {
      lastLine.items.push(item);
    }
  }

  return lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x);
    let text = "";
    let previous = null;

    for (const item of line.items) {
      const value = item.text.trim();
      if (!value) continue;

      if (!previous) {
        text += value;
        previous = item;
        continue;
      }

      const previousEndX = previous.x + previous.width;
      const gap = item.x - previousEndX;
      const needsSpace = gap > 1.5 && !/^[,.;:!?)]/.test(value) && !/[(/-]$/.test(text);
      text += needsSpace ? ` ${value}` : value;
      previous = item;
    }

    return normalizeLineSpaces(text);
  });
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    useWorkerFetch: true,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = buildPageLines(content.items || []);
    pages.push(lines.join("\n"));
  }

  return normalizeTextStructure(pages.join("\n\n"));
}

function validateFile(file) {
  if (!file) return "Không có file nào được chọn.";
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".docx") && !lower.endsWith(".pdf")) {
    return "Web này hiện hỗ trợ file .docx và .pdf. File .doc cũ chưa đọc trực tiếp ổn định trong trình duyệt.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return `File vượt quá ${MAX_FILE_SIZE_MB}MB. Bạn nên chia nhỏ file hoặc đổi sang bản nhẹ hơn.`;
  }
  return "";
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadTxt(content, originalName) {
  const base = (originalName || "vocabulary").replace(/\.[^.]+$/, "");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  downloadBlob(`${base}_english_only.txt`, blob);
}

async function downloadDocx(content, originalName) {
  const lines = content.split("\n");
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: lines.map((line) => new Paragraph({ text: line || "" })),
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const base = (originalName || "vocabulary").replace(/\.[^.]+$/, "");
  downloadBlob(`${base}_english_only.docx`, blob);
}

const CLEANING_TEST_CASES = [
  { input: "abandon: từ bỏ, ruồng bỏ", aggressive: false, expected: "abandon" },
  { input: "accomplish /əˈkʌmplɪʃ/ (v): hoàn thành", aggressive: false, expected: "accomplish /əˈkʌmplɪʃ/ (v)" },
  { input: "critical – quan trọng, mang tính quyết định", aggressive: false, expected: "critical" },
  { input: "take care of (chăm sóc)", aggressive: false, expected: "take care of" },
  { input: "1. curious tò mò", aggressive: true, expected: "curious" },
  { input: "beautiful", aggressive: false, expected: "beautiful" },
  { input: "định nghĩa", aggressive: true, expected: "" },
  { input: "go on = tiếp tục", aggressive: false, expected: "go on" },
  { input: "careful [cẩn thận]", aggressive: false, expected: "careful" },
  { input: "look after : chăm sóc", aggressive: false, expected: "look after" },
  { input: "speed up | tăng tốc", aggressive: false, expected: "speed up" },
  { input: "keep going tiếp tục", aggressive: true, expected: "keep going" },
  { input: "turn down - từ chối", aggressive: false, expected: "turn down" },
  { input: "look up (tra cứu)", aggressive: false, expected: "look up" },
];

function runCleaningTests() {
  return CLEANING_TEST_CASES.map((test, index) => {
    const actual = cleanVocabularyText(test.input, test.aggressive);
    return {
      ...test,
      id: index + 1,
      actual,
      passed: actual === test.expected,
    };
  });
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-[28px] border border-white/15 bg-white/75 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function FeaturePill({ icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3 rounded-[28px] border border-white/50 bg-white/75 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] backdrop-blur">
      <div className="rounded-2xl bg-slate-950 p-2 text-white shadow-lg">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="font-medium text-slate-950">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}

export default function VocabCleanerWeb() {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [manualInput, setManualInput] = useState("abandon: từ bỏ\naccomplish /əˈkʌmplɪʃ/ (v): hoàn thành\ncritical – quan trọng");
  const [cleanedText, setCleanedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Sẵn sàng");
  const [aggressive, setAggressive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputMode, setInputMode] = useState("file");

  const activeSource = inputMode === "paste" ? manualInput : sourceText;
  const autoCleanedText = useMemo(() => cleanVocabularyText(activeSource, aggressive), [activeSource, aggressive]);
  const testResults = useMemo(() => runCleaningTests(), []);
  const passedCount = testResults.filter((test) => test.passed).length;

  useEffect(() => {
    setCleanedText(autoCleanedText);
  }, [autoCleanedText]);

  const stats = useMemo(() => {
    const rawLines = activeSource ? activeSource.split(/\r?\n/).filter((x) => x.trim()).length : 0;
    const cleanedLines = cleanedText ? cleanedText.split(/\r?\n/).filter((x) => x.trim()).length : 0;
    const rawChars = activeSource.length;
    const cleanedChars = cleanedText.length;
    const saved = rawChars > 0 ? Math.max(0, Math.round(((rawChars - cleanedChars) / rawChars) * 100)) : 0;
    return { rawLines, cleanedLines, cleanedChars, saved };
  }, [activeSource, cleanedText]);

  async function processFile(file) {
    const validationMessage = validateFile(file);
    if (validationMessage) {
      setError(validationMessage);
      setStatus("Có lỗi");
      return;
    }

    const lower = file.name.toLowerCase();
    setIsProcessing(true);
    setError("");
    setCopied(false);
    setFileName(file.name);
    setStatus("Đang đọc file");
    setInputMode("file");

    try {
      const extracted = lower.endsWith(".docx") ? await extractTextFromDocx(file) : await extractTextFromPdf(file);
      if (!extracted.trim()) {
        throw new Error("Không trích được nội dung chữ");
      }
      setSourceText(extracted);
      setStatus("Đã xử lý xong");
    } catch (err) {
      console.error(err);
      setSourceText("");
      setCleanedText("");
      setStatus("Có lỗi");
      setError("Không đọc được file. Nếu là PDF scan ảnh hoặc file quá đặc biệt, bạn nên đổi sang PDF có text hoặc .docx.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function copyResult() {
    if (!cleanedText) return;
    try {
      await navigator.clipboard.writeText(cleanedText);
      setCopied(true);
      setStatus("Đã copy kết quả");
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error(err);
      setError("Không copy được tự động trên trình duyệt này. Bạn có thể bôi đen phần kết quả rồi copy thủ công.");
      setStatus("Có lỗi");
    }
  }

  function resetAll() {
    setFileName("");
    setSourceText("");
    setCleanedText("");
    setError("");
    setCopied(false);
    setStatus("Sẵn sàng");
    if (inputRef.current) inputRef.current.value = "";
  }

  function useManualInput() {
    setInputMode("paste");
    setError("");
    setStatus("Đang dùng văn bản dán tay");
  }

  function useFileInput() {
    setInputMode("file");
    setError("");
    setStatus(sourceText ? "Đang dùng nội dung từ file" : "Sẵn sàng");
  }

  const examples = [
    { before: "abandon: từ bỏ, ruồng bỏ", after: "abandon" },
    { before: "accomplish /əˈkʌmplɪʃ/ (v): hoàn thành", after: "accomplish /əˈkʌmplɪʃ/ (v)" },
    { before: "critical – quan trọng, mang tính quyết định", after: "critical" },
  ];

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.15),_transparent_26%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_50%,#f8fafc_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute left-[-60px] top-20 h-64 w-64 rounded-full bg-fuchsia-300/20 blur-3xl" />
        <div className="absolute right-[-40px] top-32 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute bottom-10 left-1/3 h-80 w-80 rounded-full bg-indigo-300/20 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-3 py-6 sm:px-4 sm:py-8 md:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="mb-6 rounded-[28px] border border-white/50 bg-white/70 p-5 shadow-[0_25px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl sm:rounded-[36px] sm:p-6 md:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Badge className="rounded-full border-0 bg-slate-950 px-4 py-1.5 text-white shadow-lg">
                    <Crown className="mr-2 h-3.5 w-3.5" /> Vocab Cleaner Pro
                  </Badge>
                  <Badge className="rounded-full border border-white/60 bg-white/80 px-4 py-1.5 text-slate-700 shadow-sm">
                    Mượt hơn • Ổn định hơn • Sang hơn
                  </Badge>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl md:text-5xl md:leading-tight">
                  Biến file từ vựng Anh - Việt thành bản chỉ còn tiếng Anh để học nhanh
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                  Tải <span className="font-semibold text-slate-900">.docx</span> hoặc <span className="font-semibold text-slate-900">.pdf</span>,
                  web sẽ trích nội dung, bỏ phần nghĩa tiếng Việt, cho bạn xem trước kết quả và tải xuống bản sạch.
                </p>
              </div>

              <div className="grid w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Dòng gốc" value={stats.rawLines} />
                <StatCard label="Dòng sạch" value={stats.cleanedLines} />
                <StatCard label="Ký tự còn lại" value={stats.cleanedChars} />
                <StatCard label="Rút gọn" value={`${stats.saved}%`} />
              </div>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-5 sm:gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.04 }} className="space-y-6">
            <Card className="rounded-[26px] border border-white/60 bg-white/72 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-[32px]">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-xl text-slate-950">
                  <FileUp className="h-5 w-5" /> Nguồn dữ liệu
                </CardTitle>
                <CardDescription>Chọn tải file hoặc dán văn bản trực tiếp để lọc nhanh.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={useFileInput}
                    variant={inputMode === "file" ? "default" : "outline"}
                    className={`w-full rounded-2xl sm:w-auto ${inputMode === "file" ? "bg-slate-950 text-white hover:bg-slate-900" : "bg-white/70"}`}
                  >
                    <Upload className="mr-2 h-4 w-4" /> Dùng file
                  </Button>
                  <Button
                    onClick={useManualInput}
                    variant={inputMode === "paste" ? "default" : "outline"}
                    className={`w-full rounded-2xl sm:w-auto ${inputMode === "paste" ? "bg-slate-950 text-white hover:bg-slate-900" : "bg-white/70"}`}
                  >
                    <ClipboardPaste className="mr-2 h-4 w-4" /> Dán văn bản
                  </Button>
                </div>

                {inputMode === "file" ? (
                  <label
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = e.dataTransfer.files?.[0];
                      if (dropped) processFile(dropped);
                    }}
                    className="group flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-[26px] border border-dashed border-slate-300 bg-gradient-to-br from-white via-white to-slate-100/70 p-5 text-center shadow-inner transition hover:border-slate-400 sm:min-h-64 sm:rounded-[32px] sm:p-8"
                  >
                    <div className="mb-5 rounded-3xl bg-slate-950 p-4 text-white shadow-[0_20px_40px_rgba(15,23,42,0.25)] transition group-hover:scale-[1.02]">
                      <Upload className="h-7 w-7" />
                    </div>
                    <p className="text-lg font-medium text-slate-950">Bấm để chọn file hoặc kéo thả vào đây</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Hỗ trợ .docx và .pdf có text • Giới hạn {MAX_FILE_SIZE_MB}MB</p>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(e) => processFile(e.target.files?.[0])}
                    />
                  </label>
                ) : (
                  <div className="rounded-[32px] border border-white/60 bg-gradient-to-br from-white to-slate-50 p-4 shadow-inner">
                    <Textarea
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      placeholder="Dán danh sách từ vựng vào đây..."
                      className="min-h-[220px] rounded-[20px] border-0 bg-transparent text-sm leading-7 shadow-none focus-visible:ring-0 sm:min-h-[240px] sm:rounded-[24px]"
                    />
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex items-center justify-between rounded-[28px] border border-white/60 bg-white/80 px-4 py-3 shadow-sm">
                    <div>
                      <Label htmlFor="aggressive-mode" className="cursor-pointer font-medium text-slate-950">Chế độ lọc mạnh hơn</Label>
                      <p className="mt-1 text-xs leading-5 text-slate-500">Hợp với file có nghĩa Việt dính liền sau từ.</p>
                    </div>
                    <Switch checked={aggressive} onCheckedChange={setAggressive} id="aggressive-mode" />
                  </div>
                  <div className="flex items-center justify-between rounded-[28px] border border-white/60 bg-white/80 px-4 py-3 shadow-sm">
                    <div>
                      <p className="font-medium text-slate-950">Trạng thái</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{status}</p>
                    </div>
                    <Badge className="rounded-full border-0 bg-emerald-50 px-3 py-1 text-emerald-700 shadow-sm">
                      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Ổn định
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" className="w-full rounded-2xl bg-white/70 sm:w-auto" onClick={resetAll}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Xóa dữ liệu
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full rounded-2xl bg-white/70 sm:w-auto"
                    onClick={() => setCleanedText(cleanVocabularyText(activeSource, aggressive))}
                    disabled={!activeSource}
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" /> Lọc lại ngay
                  </Button>
                </div>

                {fileName ? (
                  <div className="rounded-[24px] border border-white/60 bg-white/80 p-4 shadow-sm sm:rounded-[28px]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-2xl bg-slate-950 p-2 text-white">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-950">{fileName}</p>
                          <p className="text-xs text-slate-500">Nguồn đang dùng: file tải lên</p>
                        </div>
                      </div>
                      <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
                        {isProcessing ? "Đang xử lý" : "Sẵn sàng"}
                      </Badge>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="flex items-start gap-3 rounded-[28px] border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-700 shadow-sm">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{error}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-[26px] border border-white/60 bg-white/72 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-[32px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl text-slate-950">
                  <Wand2 className="h-5 w-5" /> Điểm mạnh của bản tối ưu
                </CardTitle>
                <CardDescription>Ưu tiên sự ổn định trước, sau đó mới đến hiệu ứng đẹp.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <FeaturePill icon={ShieldCheck} title="Ổn định hơn" description="Kiểm tra định dạng file, giới hạn dung lượng và thông báo lỗi rõ ràng hơn." />
                <FeaturePill icon={ScanText} title="Lọc linh hoạt" description="Hỗ trợ nhiều kiểu phân tách như :, -, =, |, ngoặc tròn và ngoặc vuông." />
                <FeaturePill icon={ClipboardPaste} title="Dán văn bản trực tiếp" description="Không cần file, chỉ việc paste danh sách từ vựng để xử lý nhanh." />
                <FeaturePill icon={Sparkles} title="Giao diện cao cấp" description="Kính mờ, nền sáng tinh tế, khoảng thở đẹp và tập trung vào trải nghiệm học." />
              </CardContent>
            </Card>

            <Card className="rounded-[26px] border border-white/60 bg-white/72 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-[32px]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl text-slate-950">
                  <Sparkles className="h-5 w-5" /> Ví dụ lọc
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {examples.map((item, index) => (
                  <div key={index} className="rounded-[28px] border border-white/70 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Trước</p>
                    <p className="mt-2 font-medium text-slate-950">{item.before}</p>
                    <div className="my-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Sau</p>
                    <p className="mt-2 font-semibold text-slate-950">{item.after}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.08 }} className="space-y-6">
            <Card className="rounded-[26px] border border-white/60 bg-white/72 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-[32px]">
              <CardHeader>
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-xl text-slate-950">Kết quả</CardTitle>
                    <CardDescription>Xem trước nội dung sau khi bỏ nghĩa tiếng Việt.</CardDescription>
                  </div>
                  <Badge className="rounded-full border-0 bg-slate-950 px-4 py-1.5 text-white shadow-lg">
                    <ChevronRight className="mr-1.5 h-3.5 w-3.5" /> Live Preview
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-3">
                  <Button className="w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-900 sm:w-auto" disabled={!cleanedText} onClick={() => downloadTxt(cleanedText, fileName || "vocabulary")}>
                    <Download className="mr-2 h-4 w-4" /> Tải .txt
                  </Button>
                  <Button variant="outline" className="w-full rounded-2xl bg-white/70 sm:w-auto" disabled={!cleanedText} onClick={() => downloadDocx(cleanedText, fileName || "vocabulary")}>
                    <Download className="mr-2 h-4 w-4" /> Tải .docx
                  </Button>
                  <Button variant="outline" className="w-full rounded-2xl bg-white/70 sm:w-auto" disabled={!cleanedText} onClick={copyResult}>
                    {copied ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {copied ? "Đã copy" : "Copy kết quả"}
                  </Button>
                </div>

                <Tabs defaultValue="cleaned" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-slate-100/80 p-1">
                    <TabsTrigger value="cleaned" className="rounded-2xl">Bản sạch</TabsTrigger>
                    <TabsTrigger value="raw" className="rounded-2xl">Nguồn đầu vào</TabsTrigger>
                  </TabsList>
                  <TabsContent value="cleaned" className="mt-4">
                    <div className="rounded-[28px] border border-white/70 bg-gradient-to-br from-white to-slate-50 p-3 shadow-inner">
                      <Textarea
                        value={cleanedText}
                        onChange={(e) => setCleanedText(e.target.value)}
                        placeholder="Kết quả sẽ hiện ở đây sau khi bạn tải file lên hoặc dán văn bản."
                        className="min-h-[320px] rounded-[18px] border-0 bg-transparent text-sm leading-7 shadow-none focus-visible:ring-0 sm:min-h-[460px] sm:rounded-[22px]"
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="raw" className="mt-4">
                    <div className="rounded-[28px] border border-white/70 bg-gradient-to-br from-white to-slate-50 p-3 shadow-inner">
                      <Textarea
                        value={activeSource}
                        readOnly={inputMode === "file"}
                        onChange={(e) => {
                          if (inputMode === "paste") setManualInput(e.target.value);
                        }}
                        placeholder="Nội dung gốc sẽ hiện ở đây."
                        className="min-h-[320px] rounded-[18px] border-0 bg-transparent text-sm leading-7 shadow-none focus-visible:ring-0 sm:min-h-[460px] sm:rounded-[22px]"
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card className="rounded-[26px] border border-white/60 bg-white/72 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:rounded-[32px]">
              <CardHeader>
                <CardTitle className="text-xl text-slate-950">Kiểm tra logic lọc</CardTitle>
                <CardDescription>{passedCount}/{testResults.length} test đang pass.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {testResults.map((test) => (
                  <div key={test.id} className="rounded-[24px] border border-white/70 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-950">Test {test.id}</span>
                      <Badge className={`rounded-full px-3 py-1 ${test.passed ? "border-0 bg-emerald-50 text-emerald-700" : "border-0 bg-rose-50 text-rose-700"}`}>
                        {test.passed ? "PASS" : "FAIL"}
                      </Badge>
                    </div>
                    <p className="mt-3 text-slate-500">Input: {test.input || "(rỗng)"}</p>
                    <p className="mt-1 text-slate-500">Expected: {test.expected || "(rỗng)"}</p>
                    {!test.passed ? <p className="mt-1 text-rose-600">Actual: {test.actual || "(rỗng)"}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <footer className="mt-10 pb-8">
          <div className="rounded-[24px] border border-slate-200/80 bg-white/85 px-5 py-7 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur sm:rounded-[28px] sm:px-6 md:px-10">
            <div className="flex flex-col items-center justify-center text-center">
              <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Website được làm bởi</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl md:text-5xl">Huỳnh Thiên Bảo</h2>
              <div className="mt-6 grid w-full max-w-3xl gap-4 md:grid-cols-2">
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-left shadow-sm sm:rounded-[24px] sm:px-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Số điện thoại</p>
                  <p className="mt-2 break-words text-base font-medium text-slate-900 sm:text-lg md:text-xl">0931641284</p>
                </div>
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-left shadow-sm sm:rounded-[24px] sm:px-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Email liên hệ</p>
                  <p className="mt-2 break-all text-base font-medium text-slate-900 sm:text-lg md:text-xl">huynhthienbao2008nt@gmail.com</p>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
