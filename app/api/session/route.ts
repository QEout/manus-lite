import { NextResponse } from "next/server";
import Browserbase from "@browserbasehq/sdk";

type BrowserbaseRegion =
  | "us-west-2"
  | "us-east-1"
  | "eu-central-1"
  | "ap-southeast-1";

// Exact timezone matches for east coast cities
const exactTimezoneMap: Record<string, BrowserbaseRegion> = {
  "America/New_York": "us-east-1",
  "America/Detroit": "us-east-1",
  "America/Toronto": "us-east-1",
  "America/Montreal": "us-east-1",
  "America/Boston": "us-east-1",
  "America/Chicago": "us-east-1",
};

// Prefix-based region mapping
const prefixToRegion: Record<string, BrowserbaseRegion> = {
  America: "us-west-2",
  US: "us-west-2",
  Canada: "us-west-2",
  Europe: "eu-central-1",
  Africa: "eu-central-1",
  Asia: "ap-southeast-1",
  Australia: "ap-southeast-1",
  Pacific: "ap-southeast-1",
};

// Offset ranges to regions (inclusive bounds)
const offsetRanges: {
  min: number;
  max: number;
  region: BrowserbaseRegion;
}[] = [
  { min: -24, max: -4, region: "us-west-2" }, // UTC-24 to UTC-4
  { min: -3, max: 4, region: "eu-central-1" }, // UTC-3 to UTC+4
  { min: 5, max: 24, region: "ap-southeast-1" }, // UTC+5 to UTC+24
];

function getClosestRegion(timezone?: string): BrowserbaseRegion {
  try {
    if (!timezone) {
      return "us-west-2"; // Default if no timezone provided
    }

    // Check exact matches first
    if (timezone in exactTimezoneMap) {
      return exactTimezoneMap[timezone];
    }

    // Check prefix matches
    const prefix = timezone.split("/")[0];
    if (prefix in prefixToRegion) {
      return prefixToRegion[prefix];
    }

    // Use offset-based fallback
    const date = new Date();
    // Create a date formatter for the given timezone
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    // Get the timezone offset in minutes
    const timeString = formatter.format(date);
    const testDate = new Date(timeString);
    const hourOffset = (testDate.getTime() - date.getTime()) / (1000 * 60 * 60);

    const matchingRange = offsetRanges.find(
      (range) => hourOffset >= range.min && hourOffset <= range.max
    );

    return matchingRange?.region ?? "us-west-2";
  } catch {
    return "us-west-2";
  }
}

async function createSession(timezone?: string, contextId?: string) {
  // 检查是否使用LOCAL模式（通过环境变量或其他配置）
  const useLocalMode = !process.env.BROWSERBASE_API_KEY || process.env.USE_LOCAL_MODE === 'true';
  
  if (useLocalMode) {
    // 在LOCAL模式下，简单地生成一个随机ID作为sessionId
    const localSessionId = `local-${Math.random().toString(36).substring(2, 15)}`;
    console.log("使用LOCAL模式，创建本地会话:", localSessionId);
    
    return {
      session: {
        id: localSessionId
      },
      contextId: contextId || `ctx-${Math.random().toString(36).substring(2, 15)}`
    };
  }
  
  // 以下是原有的Browserbase逻辑，仅在非LOCAL模式下执行
  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const browserSettings: { context?: { id: string; persist: boolean } } = {};
  if (contextId) {
    browserSettings.context = {
      id: contextId,
      persist: true,
    };
  } else {
    const context = await bb.contexts.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    });
    browserSettings.context = {
      id: context.id,
      persist: true,
    };
  }

  console.log("timezone ", timezone);
  console.log("getClosestRegion(timezone)", getClosestRegion(timezone));
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings,
    keepAlive: true,
    region: getClosestRegion(timezone),
  });
  return {
    session,
    contextId: browserSettings.context?.id,
  };
}

async function endSession(sessionId: string) {
  // 检查是否使用LOCAL模式
  const useLocalMode = !process.env.BROWSERBASE_API_KEY || process.env.USE_LOCAL_MODE === 'true';
  
  if (useLocalMode || sessionId.startsWith('local-')) {
    // 在LOCAL模式下，直接调用closeStagehandInstance函数
    try {
      // 导入closeStagehandInstance函数
      const { closeStagehandInstance } = await import('../stagehandManager');
      await closeStagehandInstance(sessionId);
      console.log("已清理LOCAL模式下的Stagehand实例");
    } catch (error) {
      console.error("清理LOCAL模式下的Stagehand实例失败:", error);
    }
    return;
  }
  
  // 以下是原有的Browserbase逻辑
  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  await bb.sessions.update(sessionId, {
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    status: "REQUEST_RELEASE",
  });
}

async function getDebugUrl(sessionId: string) {
  // 检查是否使用LOCAL模式
  const useLocalMode = !process.env.BROWSERBASE_API_KEY || process.env.USE_LOCAL_MODE === 'true';
  
  if (useLocalMode || sessionId.startsWith('local-')) {
    // 在LOCAL模式下，返回一个占位符URL
    return "local://chromium-instance";
  }
  
  // 以下是原有的Browserbase逻辑
  const bb = new Browserbase({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const session = await bb.sessions.debug(sessionId);
  return session.debuggerFullscreenUrl;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const timezone = body.timezone as string;
    const providedContextId = body.contextId as string;
    const { session, contextId } = await createSession(
      timezone,
      providedContextId
    );
    const liveUrl = await getDebugUrl(session.id);
    
    // 检查是否使用LOCAL模式
    const isLocalMode = !process.env.BROWSERBASE_API_KEY || 
                        process.env.USE_LOCAL_MODE === 'true' || 
                        session.id.startsWith('local-');
    
    return NextResponse.json({
      success: true,
      sessionId: session.id,
      sessionUrl: liveUrl,
      contextId,
      isLocalMode, // 添加isLocalMode标志
    });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create session" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = await request.json();
  const sessionId = body.sessionId as string;
  await endSession(sessionId);
  return NextResponse.json({ success: true });
}
