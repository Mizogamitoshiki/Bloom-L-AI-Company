/**
 * 秘密情報スキャン(V4-F)。コミット対象に APIキー・トークン・秘密鍵が混入していないか検査する。
 * Git追跡済み + 未追跡だがignoreされていないファイルを対象にする。
 * コミット前の新規ファイルも検査し、node_modules・data等のignore対象は外す。
 * 検出時は非0終了。誤検知は allowlist(下部)で除外できる。
 *
 * 実行: pnpm check:secrets
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

interface Rule {
  id: string;
  re: RegExp;
  note: string;
}

const RULES: Rule[] = [
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/, note: "Anthropic APIキー" },
  { id: "openai-key", re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/, note: "OpenAI風APIキー" },
  { id: "meta-token", re: /EA[A-Za-z0-9]{80,}/, note: "Meta/Facebookアクセストークン" },
  { id: "aws-akid", re: /AKIA[0-9A-Z]{16}/, note: "AWSアクセスキーID" },
  { id: "google-key", re: /AIza[0-9A-Za-z_-]{35}/, note: "Google APIキー" },
  { id: "github-pat", re: /ghp_[A-Za-z0-9]{36}/, note: "GitHub Personal Access Token" },
  { id: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/, note: "Slackトークン" },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, note: "秘密鍵(PEM)" },
  { id: "generic-secret", re: /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9/+_-]{16,}['"]/i, note: "汎用シークレット代入" },
];

// 誤検知の除外(このスクリプト自身のパターン定義など)
const ALLOW_FILES = new Set<string>([
  "scripts/check-secrets.ts",
]);
// 行に含まれていれば無視するマーカー(例示・プレースホルダ用)
const ALLOW_MARKERS = [/EXAMPLE/i, /placeholder/i, /your[_-]?key/i, /xxxx+/i, /\.env\.example/];

function filesToScan(): string[] {
  const out = execSync("git ls-files --cached --others --exclude-standard -z", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function isProbablyBinary(file: string): boolean {
  if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|woff2?|ttf|otf|db|sqlite|node)$/i.test(file)) return true;
  try {
    if (statSync(file).size > 2 * 1024 * 1024) return true;
  } catch {
    return true;
  }
  return false;
}

interface Hit {
  file: string;
  line: number;
  rule: string;
  note: string;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of filesToScan()) {
    if (ALLOW_FILES.has(file) || isProbablyBinary(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (ALLOW_MARKERS.some((m) => m.test(line))) continue;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          hits.push({ file, line: i + 1, rule: rule.id, note: rule.note });
        }
      }
    }
  }
  return hits;
}

const hits = scan();
if (hits.length === 0) {
  process.stdout.write("check:secrets OK — 追跡済み・コミット候補の新規ファイルに秘密情報の混入は見つかりませんでした。\n");
  process.exit(0);
}
process.stderr.write("check:secrets FAILED — 秘密情報の疑いがあります:\n");
for (const h of hits) {
  process.stderr.write(`  ${h.file}:${h.line} [${h.rule}] ${h.note}\n`);
}
process.stderr.write("\n誤検知の場合は scripts/check-secrets.ts の ALLOW_MARKERS/ALLOW_FILES を調整してください。\n");
process.exit(1);
