"use client";
import type { JSX } from "react";
import type { CompanyStateView } from "@adapters/db/store";
import { StatusBadge } from "./StatusBadge";

/** アニメーション無効時の等価情報一覧(確定§13) */
export function ListView({
  state,
  onSelect,
}: {
  state: CompanyStateView;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div className="list-view" id="main">
      <table>
        <caption style={{ textAlign: "left", fontWeight: 700, paddingBottom: 8 }}>
          AI社員の状態一覧({state.today})
        </caption>
        <thead>
          <tr>
            <th scope="col">社員</th>
            <th scope="col">役職</th>
            <th scope="col">状態</th>
            <th scope="col">現在のタスク</th>
            <th scope="col">理由・補足</th>
            <th scope="col">最終更新</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {state.employees.map((e) => (
            <tr key={e.id}>
              <th scope="row">{e.name}</th>
              <td>{e.role}</td>
              <td>
                <StatusBadge state={e.display.state} />
              </td>
              <td>{e.currentTaskTitle ?? "—"}</td>
              <td>{e.display.reason}</td>
              <td>{e.display.lastEventAt ? new Date(e.display.lastEventAt).toLocaleTimeString("ja-JP") : "—"}</td>
              <td>
                <button type="button" className="btn-secondary" onClick={() => onSelect(e.id)}>
                  詳細
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
