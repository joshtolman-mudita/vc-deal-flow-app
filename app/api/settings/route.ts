import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_APP_SETTINGS } from "@/lib/app-settings";

const SETTINGS_FILE = path.join(process.cwd(), "app-settings.json");

export async function GET() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      ...(parsed || {}),
      scoringWeights: {
        ...DEFAULT_APP_SETTINGS.scoringWeights,
        ...(parsed?.scoringWeights || {}),
      },
    };
    return NextResponse.json({ settings });
  } catch (error) {
    // File doesn't exist yet, return defaults
    return NextResponse.json({
      settings: DEFAULT_APP_SETTINGS,
    });
  }
}

export async function POST(req: Request) {
  try {
    const settings = await req.json();
    
    // Save to file
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
    
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    console.error("Error saving settings:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save settings" },
      { status: 500 }
    );
  }
}


