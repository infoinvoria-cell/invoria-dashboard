import { NextResponse } from "next/server";

import { listEdgeStrategies, saveEdgeStrategyFromCsv } from "@/lib/edgePortfolioStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const strategies = await listEdgeStrategies();
    return NextResponse.json({ strategies });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load strategies." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const name = String(formData.get("name") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
    }

    const content = await file.text();
    const strategy = await saveEdgeStrategyFromCsv(content, file.name, name);
    return NextResponse.json({ strategy }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save strategy." },
      { status: 500 },
    );
  }
}
