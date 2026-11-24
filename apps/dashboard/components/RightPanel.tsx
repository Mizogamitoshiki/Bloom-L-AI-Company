"use client";
import type { JSX } from "react";
import type { HomeView } from "@adapters/db/views";
import type { DisplayState } from "@core/domain";
import { PixelAvatar } from "./PixelAvatar";
import { Card, FooterLink } from "./ui";
import { IconCheck } from "./icons";

const HUE: Record<string, number> = {
  emp_aoi: 150, emp_ren: 210, emp_rin: 30, emp_sora: 190, emp_kotoha: 330,
  emp_tsumugi: 270, emp_shion: 250, emp_minato: 200,
};

function elapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return "—";
  const sec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RightPanel({ home, now, onSelect }: { home: HomeView; now: number; onSelect: (id: string) => void }): JSX.Element {
  return (
    <>
      <Card title={home.currentJobs.length > 0 ? "現在の仕事" : "社員ステータス"}>
        {home.currentJobs.length > 0 ? (
          <>
            <div className="side-list">
              {home.currentJobs.map((j) => (
                <button
                  key={j.employeeId}
                  type="button"
                  className="side-row"
                  onClick={() => onSelect(j.employeeId)}
                  style={{ background: "transparent", border: "none", width: "100%", textAlign: "left" }}
                  aria-label={`${j.name} ${j.taskTitle ?? ""} の詳細`}
                >
                  <span className="side-row__avatar" aria-hidden="true">
                    <PixelAvatar hue={HUE[j.employeeId] ?? 200} seed={j.employeeId} />
                  </span>
                  <span className="side-row__main">
                    <span className="side-row__name">{j.name}</span>
                    <span className="side-row__task">{j.taskTitle ?? "(タスク情報なし)"}</span>
                  </span>
                  <span className="side-row__meta">{elapsed(j.startedAt, now)}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="side-list" aria-label="待機中を含む社員ステータス">
            {home.state.employees.slice(0, 5).map((employee) => (
              <button
                key={employee.id}
                type="button"
                className="side-row"
                onClick={() => onSelect(employee.id)}
                style={{ background: "transparent", border: "none", width: "100%", textAlign: "left" }}
                aria-label={`${employee.name} ${employee.display.reason} の詳細`}
              >
                <span className="side-row__avatar" aria-hidden="true">
                  <PixelAvatar hue={employee.spriteHue} seed={employee.id} />
                </span>
                <span className="side-row__main">
                  <span className="side-row__name">{employee.name}</span>
                  <span className="side-row__task">{employee.display.reason}</span>
                </span>
                <span className="side-row__meta">{stateLabel(employee.display.state)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title={`承認待ち ${home.approvals.length > 0 ? home.approvals.length : ""}`.trim()}>
        {home.approvals.length > 0 ? (
          <>
            {home.approvals.map((a) => (
              <div key={a.postId} className="side-approval">
                <div className="side-approval__head">
                  <span className="side-approval__title">{a.title}</span>
                  <span className="side-approval__meta">{a.ageMinutes !== null ? `${a.ageMinutes}分前` : ""}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 6px" }}>
                  {a.employeeName ?? "—"} ・ {a.format === "carousel" ? "Instagramカルーセル" : a.format}
                </div>
                <div className="post-preview__thumbs">
                  {a.imageArtifactIds.slice(0, 3).map((id, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={id} src={`/api/artifacts/${id}/file`} alt={`カルーセル ${i + 1}枚目`} />
                  ))}
                  {a.imageArtifactIds.length > 3 ? <span className="post-preview__more">+{a.imageArtifactIds.length - 3}</span> : null}
                  {a.imageArtifactIds.length === 0 ? <span className="post-preview__more">画像なし</span> : null}
                </div>
                <a className="btn btn--primary btn--sm btn--block" href="/approvals" style={{ marginTop: 8 }}>
                  承認画面で確認する
                </a>
              </div>
            ))}
            <FooterLink href="/approvals">すべての承認待ちを見る</FooterLink>
          </>
        ) : (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>承認待ちの投稿はありません。</p>
        )}
      </Card>

      <Card title="今日の成果">
        {home.todayResults.length > 0 ? (
          home.todayResults.map((r) => (
            <div key={r.label} className="side-result">
              <IconCheck size={16} />
              <span>
                {r.label} <strong>{r.count}件</strong> 完了
              </span>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>本日完了した成果はまだありません。</p>
        )}
      </Card>
    </>
  );
}

/** 社員状態のスクリーンリーダー向け代替一覧(オフィスの代替) */
export function OfficeSrAlternative({ employees }: { employees: HomeView["state"]["employees"] }): JSX.Element {
  return (
    <div className="sr-only">
      <h2>AI社員の状態一覧</h2>
      <ul>
        {employees.map((e) => (
          <li key={e.id}>
            {e.name}({e.role}): {stateLabel(e.display.state)} — {e.display.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function stateLabel(s: DisplayState): string {
  return { idle: "待機", researching: "調査中", meeting: "会議中", creating: "制作中", qa: "品質確認中", awaiting_approval: "承認待ち", done_today: "本日完了", error: "エラー", budget_paused: "予算停止", stale: "状態不明" }[s];
}
