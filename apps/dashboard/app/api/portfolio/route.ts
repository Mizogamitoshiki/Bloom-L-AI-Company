import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { listPortfolio, addPortfolioItem } from "@adapters/db/store";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(listPortfolio(db));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}

const addSchema = z
  .object({
    customerName: z.string().min(1).max(100),
    siteUrl: z.string().url().max(300).optional().or(z.literal("")),
    anonymousName: z.string().max(50).optional(),
    summary: z.string().max(500).optional(),
    technologies: z.array(z.string().max(30)).max(10).optional(),
    problem: z.string().max(500).optional(),
    testimonial: z.string().max(500).optional(),
    assetsPath: z.string().max(300).optional(),
  })
  .strict();

/** 実績の登録(代表者)。公開許可は初期状態pending(V3-C) */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const input = addSchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      const r = addPortfolioItem(db, { ...input, siteUrl: input.siteUrl || undefined }, "owner");
      return NextResponse.json({ ok: true, ...r });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
