import { NextRequest, NextResponse } from "next/server";
import { TypeSafeClient } from "@typesafe-ai/sdk";

const apiKey = process.env.TYPESAFE_API_KEY;
let client: TypeSafeClient | null = null;

function getClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient({ apiKey });
  }
  return client;
}

export async function POST(req: NextRequest) {
  try {
    const { state, questions, model = "jev-latest" } = await req.json();

    if (!apiKey) {
      return NextResponse.json({ error: "TYPESAFE_API_KEY not set" }, { status: 500 });
    }

    const typeSafe = getClient();
    const result = await typeSafe.systemOne({
      state,
      questions,
      model,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const errorObj = err as { message?: string; status?: number };
    console.error("[TypeSafe API Error]:", err);
    return NextResponse.json(
      { error: errorObj?.message || String(err) },
      { status: errorObj?.status || 500 }
    );
  }
}
