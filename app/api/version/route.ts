import { NextResponse } from "next/server";

// Public deploy marker — bump BUILD_TAG with meaningful releases so "what is
// production actually running?" is answerable from outside without auth.
const BUILD_TAG = "orgchart-2";

export async function GET() {
  return NextResponse.json({ build: BUILD_TAG });
}
