import { NextResponse } from 'next/server';
import { closeAllStagehandInstances } from '../stagehandManager';

export async function POST() {
  try {
    await closeAllStagehandInstances();
    return NextResponse.json({ success: true, message: '所有Stagehand实例已关闭' });
  } catch (error) {
    console.error('清理Stagehand实例时出错:', error);
    return NextResponse.json(
      { success: false, error: '清理Stagehand实例失败' },
      { status: 500 }
    );
  }
} 