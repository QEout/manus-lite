import { Stagehand } from "@browserbasehq/stagehand";

// 存储会话ID到Stagehand实例的映射
const stagehandInstances: Map<string, Stagehand> = new Map();

// 获取或创建Stagehand实例
export async function getStagehandInstance(sessionID: string): Promise<Stagehand> {
  // 检查是否已存在该会话的实例
  let stagehand = stagehandInstances.get(sessionID);
  
  if (!stagehand) {
    // 如果不存在，创建新实例
    stagehand = new Stagehand({
      browserbaseSessionID: sessionID,
      // enableCaching: true,
      env: process.env.USE_LOCAL_MODE === 'true' ? "LOCAL" : "BROWSERBASE"
    });
    
    // 初始化实例
    await stagehand.init();
    
    // 存储实例
    stagehandInstances.set(sessionID, stagehand);
    
    console.log(`Created new Stagehand instance for session: ${sessionID}`);
  }
  
  return stagehand;
}

// 关闭并移除Stagehand实例
export async function closeStagehandInstance(sessionID: string): Promise<void> {
  const stagehand = stagehandInstances.get(sessionID);
  
  if (stagehand) {
    try {
      await stagehand.close();
      stagehandInstances.delete(sessionID);
      console.log(`Closed Stagehand instance for session: ${sessionID}`);
    } catch (error) {
      console.error(`Error closing Stagehand instance for session: ${sessionID}`, error);
    }
  }
}

// 关闭所有Stagehand实例
export async function closeAllStagehandInstances(): Promise<void> {
  const closePromises: Promise<void>[] = [];
  
  for (const [sessionID, stagehand] of stagehandInstances.entries()) {
    closePromises.push(
      stagehand.close().then(() => {
        console.log(`Closed Stagehand instance for session: ${sessionID}`);
      }).catch((error) => {
        console.error(`Error closing Stagehand instance for session: ${sessionID}`, error);
      })
    );
  }
  
  await Promise.all(closePromises);
  stagehandInstances.clear();
  console.log('All Stagehand instances closed');
} 