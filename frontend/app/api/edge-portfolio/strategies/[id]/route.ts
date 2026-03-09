import { NextResponse } from "next/server";

import { deleteEdgeStrategy, renameEdgeStrategy } from "@/lib/edgePortfolioStore";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    id: string;
  };
};

export async function PATCH(request: Request, { params }: Context) {
  try {
    const payload = (await request.json()) as { name?: string };
    const name = String(payload?.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }

    const strategy = await renameEdgeStrategy(params.id, name);
    return NextResponse.json({ strategy });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rename strategy." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    await deleteEdgeStrategy(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete strategy." },
      { status: 500 },
    );
  }
}
