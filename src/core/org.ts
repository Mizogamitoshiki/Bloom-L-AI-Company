/**
 * 初期組織データ(docs/04, 05)。2026-07-13 代表者承認済みの名前・役職。
 * 2026-07-17 代表者指示によりマーケティング本部/インスタ運用チームの2階層へ再編し、
 * 秘書・PM・PMO・リサーチプロフェッショナルの4名を追加(DECISIONS.md D-16)。
 * 表示キャラクターと実行プロセスは分離される(§9)。2026-07-24 V8で椿(Canvaデザイナー)を追加。2026-07-27 実働ゼロの陽葵(DM支援・第2段階専用)を代表者指示で削除し13名。
 */
import type { ModelProfile } from "./domain";

export interface DepartmentSeed {
  id: string;
  name: string;
  status: "active" | "planned";
  unlockNote: string | null;
}

export const DEPARTMENTS: DepartmentSeed[] = [
  { id: "dept_marketing", name: "Bloom-L AIマーケティング本部", status: "active", unlockNote: null },
  {
    id: "dept_ig_ops",
    name: "インスタ運用チーム",
    status: "active",
    unlockNote: null,
  },
  {
    id: "dept_sales",
    name: "AI営業部",
    status: "planned",
    unlockNote:
      "将来の役割: 見込み客リスト整理・提案書下書き。解放条件(案): マーケ部が安定運用60日+DM相談月5件。",
  },
  {
    // V10(2026-08-26 代表者指示・D-19): サンプルサイト制作のため限定解放
    id: "dept_web",
    name: "AI Web制作部",
    status: "active",
    unlockNote:
      "2026-08-26 代表者指示で限定解放(サンプルサイト制作)。制作進行管理・素材収集支援は受注が月2件を超えたときに拡張。",
  },
  {
    id: "dept_dev",
    name: "AI開発部",
    status: "planned",
    unlockNote:
      "将来の役割: SaaS・業務システムの要件整理支援。解放条件(案): 上位提案の商談が発生したとき。",
  },
  {
    id: "dept_admin",
    name: "AI経理・管理部",
    status: "planned",
    unlockNote:
      "将来の役割: 請求・入金管理の下書き。解放条件(案): 取引件数が手作業限界を超えたとき。",
  },
];

export interface EmployeeSeed {
  id: string;
  departmentId: string;
  name: string;
  role: string;
  agentRef: string;
  modelProfile: ModelProfile;
  /** スプライトの識別色(プレースホルダー)。状態表現には使用しない(状態はテキスト+アイコン) */
  spriteHue: number;
  /** MVPで実行経路を持つか */
  activeInMvp: boolean;
}

export const EMPLOYEES: EmployeeSeed[] = [
  // ---- 本部レベル(戦略・分析・横断支援) ----
  { id: "emp_aoi", departmentId: "dept_marketing", name: "葵", role: "AI社長補佐", agentRef: "aoi", modelProfile: "standard", spriteHue: 150, activeInMvp: true },
  { id: "emp_ren", departmentId: "dept_marketing", name: "蓮", role: "CMO(集客戦略統括)", agentRef: "ren", modelProfile: "standard", spriteHue: 210, activeInMvp: true },
  { id: "emp_rin", departmentId: "dept_marketing", name: "凛", role: "リサーチ担当", agentRef: "rin", modelProfile: "standard", spriteHue: 30, activeInMvp: true },
  { id: "emp_minato", departmentId: "dept_marketing", name: "湊", role: "データ分析担当", agentRef: "minato", modelProfile: "light", spriteHue: 200, activeInMvp: true },
  // ---- 2026-07-17 組織拡張(代表者指示。DECISIONS.md D-16) ----
  { id: "emp_mizuki", departmentId: "dept_marketing", name: "美月", role: "CEO秘書", agentRef: "mizuki", modelProfile: "light", spriteHue: 300, activeInMvp: true },
  { id: "emp_kikyou", departmentId: "dept_marketing", name: "桔梗", role: "PM(進行管理担当)", agentRef: "kikyou", modelProfile: "standard", spriteHue: 15, activeInMvp: true },
  { id: "emp_kaede", departmentId: "dept_marketing", name: "楓", role: "PMO(品質・プロセス統括担当)", agentRef: "kaede", modelProfile: "standard", spriteHue: 120, activeInMvp: true },
  { id: "emp_azusa", departmentId: "dept_marketing", name: "梓", role: "リサーチプロフェッショナル(上級検証担当)", agentRef: "azusa", modelProfile: "heavy", spriteHue: 60, activeInMvp: true },
  // ---- インスタ運用チーム(コンテンツ制作の実行担当) ----
  { id: "emp_sora", departmentId: "dept_ig_ops", name: "昊", role: "コンテンツ企画担当", agentRef: "sora", modelProfile: "standard", spriteHue: 190, activeInMvp: true },
  { id: "emp_kotoha", departmentId: "dept_ig_ops", name: "琴葉", role: "コピーライター", agentRef: "kotoha", modelProfile: "standard", spriteHue: 330, activeInMvp: true },
  { id: "emp_tsumugi", departmentId: "dept_ig_ops", name: "紬", role: "デザイナー", agentRef: "tsumugi", modelProfile: "standard", spriteHue: 270, activeInMvp: true },
  // ---- 2026-07-24 V8/D-18: Canvaレンダリング経路の専任デザイナー(代表者指示) ----
  { id: "emp_tsubaki", departmentId: "dept_ig_ops", name: "椿", role: "Canvaデザイナー", agentRef: "tsubaki", modelProfile: "standard", spriteHue: 90, activeInMvp: true },
  { id: "emp_shion", departmentId: "dept_ig_ops", name: "紫苑", role: "品質管理担当", agentRef: "shion", modelProfile: "standard", spriteHue: 250, activeInMvp: true },
  // ---- 2026-08-26 V10/D-19: AI Web制作部(限定解放)。サンプルサイト制作担当(代表者指示) ----
  { id: "emp_hayate", departmentId: "dept_web", name: "颯", role: "Web制作担当", agentRef: "hayate", modelProfile: "standard", spriteHue: 45, activeInMvp: true },
];
