/**
 * 初期組織データ(docs/04, 05)。2026-07-13 代表者承認済みの名前・役職。
 * 表示キャラクター(9名)と実行プロセスは分離される(§9)。
 */
import type { ModelProfile } from "./domain";

export interface DepartmentSeed {
  id: string;
  name: string;
  status: "active" | "planned";
  unlockNote: string | null;
}

export const DEPARTMENTS: DepartmentSeed[] = [
  { id: "dept_marketing", name: "Bloom-L AIマーケティング部", status: "active", unlockNote: null },
  {
    id: "dept_sales",
    name: "AI営業部",
    status: "planned",
    unlockNote:
      "将来の役割: 見込み客リスト整理・提案書下書き。解放条件(案): マーケ部が安定運用60日+DM相談月5件。",
  },
  {
    id: "dept_web",
    name: "AI Web制作部",
    status: "planned",
    unlockNote:
      "将来の役割: 制作進行管理・素材収集支援。解放条件(案): 受注が月2件を超え制作管理が逼迫したとき。",
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
  /** MVPで実行経路を持つか。陽葵はDM支援が第2段階のため表示のみ(DECISIONS 2026-07-13) */
  activeInMvp: boolean;
}

export const EMPLOYEES: EmployeeSeed[] = [
  { id: "emp_aoi", departmentId: "dept_marketing", name: "葵", role: "AI社長補佐", agentRef: "aoi", modelProfile: "standard", spriteHue: 150, activeInMvp: true },
  { id: "emp_ren", departmentId: "dept_marketing", name: "蓮", role: "集客戦略責任者", agentRef: "ren", modelProfile: "standard", spriteHue: 210, activeInMvp: true },
  { id: "emp_rin", departmentId: "dept_marketing", name: "凛", role: "リサーチ担当", agentRef: "rin", modelProfile: "standard", spriteHue: 30, activeInMvp: true },
  { id: "emp_sora", departmentId: "dept_marketing", name: "昊", role: "コンテンツ企画担当", agentRef: "sora", modelProfile: "standard", spriteHue: 190, activeInMvp: true },
  { id: "emp_kotoha", departmentId: "dept_marketing", name: "琴葉", role: "コピーライター", agentRef: "kotoha", modelProfile: "standard", spriteHue: 330, activeInMvp: true },
  { id: "emp_tsumugi", departmentId: "dept_marketing", name: "紬", role: "デザイナー", agentRef: "tsumugi", modelProfile: "standard", spriteHue: 270, activeInMvp: true },
  { id: "emp_shion", departmentId: "dept_marketing", name: "紫苑", role: "品質管理担当", agentRef: "shion", modelProfile: "standard", spriteHue: 250, activeInMvp: true },
  { id: "emp_minato", departmentId: "dept_marketing", name: "湊", role: "データ分析担当", agentRef: "minato", modelProfile: "light", spriteHue: 200, activeInMvp: true },
  { id: "emp_hinata", departmentId: "dept_marketing", name: "陽葵", role: "顧客対応担当", agentRef: "hinata", modelProfile: "standard", spriteHue: 45, activeInMvp: false },
];
