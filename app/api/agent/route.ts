import { NextResponse } from 'next/server';
import { LLMClient } from '@/utils/model';
import { CoreMessage, generateObject, UserContent } from "ai";
import { z } from "zod";
import { ObserveResult } from "@browserbasehq/stagehand";
import { getStagehandInstance, closeStagehandInstance } from '../stagehandManager';


type Step = {
  text: string;
  reasoning: string;
  tool: "GOTO" | "ACT" | "EXTRACT" | "OBSERVE" | "CLOSE" | "WAIT" | "NAVBACK" | "USER_INPUT";
  instruction: string;
};

async function runStagehand({
  sessionID,
  method,
  instruction,
}: {
  sessionID: string;
  method: "GOTO" | "ACT" | "EXTRACT" | "CLOSE" | "SCREENSHOT" | "OBSERVE" | "WAIT" | "NAVBACK" | "USER_INPUT";
  instruction?: string;
}) {
  const stagehand = await getStagehandInstance(sessionID);
  const page = stagehand.page;

  try {
    switch (method) {
      case "GOTO":
        await page.goto(instruction!, {
          waitUntil: "commit",
          timeout: 60000,
        });
        break;

      case "ACT":
        await page.act(instruction!);
        break;

      case "EXTRACT": {
        const { extraction } = await page.extract(instruction!);
        return extraction;
      }

      case "OBSERVE":
        return await page.observe({
          instruction,
          useAccessibilityTree: true,
        });

      case "CLOSE":
        await closeStagehandInstance(sessionID);
        break;

      case "SCREENSHOT": {
        const cdpSession = await page.context().newCDPSession(page);
        const { data } = await cdpSession.send("Page.captureScreenshot");
        return data;
      }

      case "WAIT":
        await new Promise((resolve) =>
          setTimeout(resolve, Number(instruction))
        );
        break;

      case "NAVBACK":
        await page.goBack();
        break;

      case "USER_INPUT":
        return {
          status: "waiting_for_user",
          message: instruction || "请处理验证码或登录信息",
        };
    }
  } catch (error) {
    await closeStagehandInstance(sessionID);
    throw error;
  }
}

async function sendPrompt({
  goal,
  sessionID,
  previousSteps = [],
  previousExtraction,
}: {
  goal: string;
  sessionID: string;
  previousSteps?: Step[];
  previousExtraction?: string | ObserveResult[];
}) {
  let currentUrl = "";

  try {
    const stagehand = await getStagehandInstance(sessionID);
    currentUrl = await stagehand.page.url();
  } catch (error) {
    console.error('Error getting page info:', error);
  }

  const content: UserContent = [
    {
      type: "text",
      text: `你是一个网页浏览助手，帮助用户完成目标: "${goal}"。
${
  previousSteps.length > 0
    ? `
到目前为止，你已经执行了以下步骤:
${previousSteps
  .map(
    (step, i) =>
      `${i + 1}. ${step.text} (使用工具: ${step.tool}, 指令: ${
        step.instruction
      })`
  )
  .join("\n")}

当前URL是: ${currentUrl}
`
    : ""
}
${
  previousExtraction
    ? `
最近的提取或观察结果:
${
  typeof previousExtraction === "string"
    ? previousExtraction
    : JSON.stringify(previousExtraction, null, 2)
}
`
    : ""
}

请决定下一步操作。你可以使用以下工具:
1. GOTO: 导航到一个URL
2. ACT: 在页面上执行操作 (点击, 输入文本等)
3. EXTRACT: 从页面提取信息
4. OBSERVE: 观察页面的当前状态
5. WAIT: 等待页面加载或元素出现
6. NAVBACK: 返回上一页
7. CLOSE: 完成任务并关闭会话
8. USER_INPUT: 当遇到验证码、登录要求或其他需要用户手动操作的情况时使用此工具，系统将暂停自动操作，等待用户手动处理后继续

请提供:
1. 你的推理过程
2. 要使用的工具
3. 详细的指令

如果你遇到验证码、登录页面或其他需要用户手动操作的情况，请使用USER_INPUT工具，并在指令中清楚说明用户需要做什么。`,
    },
  ];

  // Add screenshot if navigated to a page previously
  if (previousSteps.length > 0 && previousSteps.some((step) => step.tool === "GOTO")) {
    content.push({
      type: "image",
      image: (await runStagehand({
        sessionID,
        method: "SCREENSHOT",
      })) as string,
    });
  }

  if (previousExtraction) {
    content.push({
      type: "text",
      text: `The result of the previous ${
        Array.isArray(previousExtraction) ? "observation" : "extraction"
      } is: ${previousExtraction}.`,
    });
  }

  const message: CoreMessage = {
    role: "user",
    content,
  };

  const result = await generateObject({
    model: LLMClient,
    schema: z.object({
      text: z.string(),
      reasoning: z.string(),
      tool: z.enum([
        "GOTO",
        "ACT",
        "EXTRACT",
        "OBSERVE",
        "CLOSE",
        "WAIT",
        "NAVBACK",
        "USER_INPUT",
      ]),
      instruction: z.string(),
    }),
    messages: [message],
  });

  return {
    result: result.object,
    previousSteps: [...previousSteps, result.object],
  };
}

async function selectStartingUrl(goal: string) {
  const message: CoreMessage = {
    role: "user",
    content: [{
      type: "text",
      text: `根据目标: "${goal}", 确定最佳的起始URL。
可选择:
1. 相关搜索引擎 (Baidu, Google, Bing等)
2. 如果你确定目标网站，可以直接使用其URL
3. 任何其他适合的起始点

返回一个最有效实现此目标的URL。`
    }]
  };

  const result = await generateObject({
    model: LLMClient,
    schema: z.object({
      url: z.string().url(),
      reasoning: z.string()
    }),
    messages: [message]
  });

  return result.object;
}

export async function GET() {
  return NextResponse.json({ message: 'Agent API endpoint ready' });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { goal, sessionId, previousSteps = [], action } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: '请求体中缺少sessionId' },
        { status: 400 }
      );
    }

    // Handle different action types
    switch (action) {
      case 'START': {
        if (!goal) {
          return NextResponse.json(
            { error: '请求体中缺少goal' },
            { status: 400 }
          );
        }

        // Handle first step with URL selection
        const { url, reasoning } = await selectStartingUrl(goal);
        const firstStep = {
          text: `导航至 ${url}`,
          reasoning,
          tool: "GOTO" as const,
          instruction: url
        };
        
        await runStagehand({
          sessionID: sessionId,
          method: "GOTO",
          instruction: url
        });

        return NextResponse.json({ 
          success: true,
          result: firstStep,
          steps: [firstStep],
          done: false
        });
      }

      case 'GET_NEXT_STEP': {
        if (!goal) {
          return NextResponse.json(
            { error: '请求体中缺少goal' },
            { status: 400 }
          );
        }

        // Get the next step from the LLM
        const { result, previousSteps: newPreviousSteps } = await sendPrompt({
          goal,
          sessionID: sessionId,
          previousSteps,
        });

        return NextResponse.json({
          success: true,
          result,
          steps: newPreviousSteps,
          done: result.tool === "CLOSE"
        });
      }

      case 'EXECUTE_STEP': {
        const { step } = body;
        if (!step) {
          return NextResponse.json(
            { error: '请求体中缺少step' },
            { status: 400 }
          );
        }

        try {
          // 处理USER_INPUT步骤
          if (step.tool === "USER_INPUT") {
            return NextResponse.json({
              success: true,
              message: step.instruction || "请处理验证码或登录信息",
              done: false
            });
          }

          // 处理其他步骤类型
          const result = await runStagehand({
            sessionID: sessionId,
            method: step.tool,
            instruction: step.instruction,
          });

          return NextResponse.json({
            success: true,
            result,
            done: step.tool === "CLOSE",
          });
        } catch (error) {
          console.error('Error executing step:', error);
          return NextResponse.json(
            { error: '执行步骤时出错', details: (error as Error).message },
            { status: 500 }
          );
        }
      }

      default:
        return NextResponse.json(
          { error: '无效的action类型' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Agent端点错误:', error);
    return NextResponse.json(
      { success: false, error: '处理请求失败' },
      { status: 500 }
    );
  }
} 