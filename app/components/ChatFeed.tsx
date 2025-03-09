"use client";

import { motion } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import { useWindowSize } from "usehooks-ts";
import Image from "next/image";
import { useAtom } from "jotai/react";
import { contextIdAtom } from "../atoms";
import posthog from "posthog-js";

interface ExtendedWindow extends Window {
  continueAfterUserInput?: () => void;
}

interface ChatFeedProps {
  initialMessage?: string;
  onClose: () => void;
  url?: string;
}

export interface BrowserStep {
  text: string;
  reasoning: string;
  tool: "GOTO" | "ACT" | "EXTRACT" | "OBSERVE" | "CLOSE" | "WAIT" | "NAVBACK" | "USER_INPUT";
  instruction: string;
  stepNumber?: number;
}

interface AgentState {
  sessionId: string | null;
  sessionUrl: string | null;
  steps: BrowserStep[];
  isLoading: boolean;
}

export default function ChatFeed({ initialMessage, onClose }: ChatFeedProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { width } = useWindowSize();
  const isMobile = width ? width < 768 : false;
  const initializationRef = useRef(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [isAgentFinished, setIsAgentFinished] = useState(false);
  const [contextId, setContextId] = useAtom(contextIdAtom);
  const agentStateRef = useRef<AgentState>({
    sessionId: null,
    sessionUrl: null,
    steps: [],
    isLoading: false,
  });

  const [uiState, setUiState] = useState<{
    sessionId: string | null;
    sessionUrl: string | null;
    steps: BrowserStep[];
    isLocalMode: boolean;
    waitingForUserInput: boolean;
    userInputMessage: string | null;
  }>({
    sessionId: null,
    sessionUrl: null,
    steps: [],
    isLocalMode: false,
    waitingForUserInput: false,
    userInputMessage: null,
  });

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (
      uiState.steps.length > 0 &&
      uiState.steps[uiState.steps.length - 1].tool === "CLOSE"
    ) {
      setIsAgentFinished(true);
      fetch("/api/session", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: uiState.sessionId,
        }),
      });
    }
  }, [uiState.sessionId, uiState.steps]);

  useEffect(() => {
    scrollToBottom();
  }, [uiState.steps, scrollToBottom]);

  useEffect(() => {
    console.log("useEffect called");
    const initializeSession = async () => {
      if (initializationRef.current) return;
      initializationRef.current = true;

      if (initialMessage && !agentStateRef.current.sessionId) {
        setIsLoading(true);
        try {
          const sessionResponse = await fetch("/api/session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              contextId: contextId,
            }),
          });
          const sessionData = await sessionResponse.json();

          if (!sessionData.success) {
            throw new Error(sessionData.error || "Failed to create session");
          }

          setContextId(sessionData.contextId);

          agentStateRef.current = {
            ...agentStateRef.current,
            sessionId: sessionData.sessionId,
            sessionUrl: sessionData.sessionUrl.replace(
              "https://www.browserbase.com/devtools-fullscreen/inspector.html",
              "https://www.browserbase.com/devtools-internal-compiled/index.html"
            ),
          };

          setUiState({
            sessionId: sessionData.sessionId,
            sessionUrl: sessionData.sessionUrl.replace(
              "https://www.browserbase.com/devtools-fullscreen/inspector.html",
              "https://www.browserbase.com/devtools-internal-compiled/index.html"
            ),
            steps: [],
            isLocalMode: sessionData.isLocalMode,
            waitingForUserInput: false,
            userInputMessage: null,
          });

          const response = await fetch("/api/agent", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              goal: initialMessage,
              sessionId: sessionData.sessionId,
              action: "START",
            }),
          });

          const data = await response.json();
          posthog.capture("agent_start", {
            goal: initialMessage,
            sessionId: sessionData.sessionId,
            contextId: sessionData.contextId,
          });

          if (data.success) {
            const newStep = {
              text: data.result.text,
              reasoning: data.result.reasoning,
              tool: data.result.tool,
              instruction: data.result.instruction,
              stepNumber: 1,
            };

            agentStateRef.current = {
              ...agentStateRef.current,
              steps: [newStep],
            };

            setUiState((prev) => ({
              ...prev,
              steps: [newStep],
            }));

            // Continue with subsequent steps
            while (true) {
              // Get next step from LLM
              const nextStepResponse = await fetch("/api/agent", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  goal: initialMessage,
                  sessionId: sessionData.sessionId,
                  previousSteps: agentStateRef.current.steps,
                  action: "GET_NEXT_STEP",
                }),
              });

              const nextStepData = await nextStepResponse.json();

              if (!nextStepData.success) {
                throw new Error("Failed to get next step");
              }

              // Add the next step to UI immediately after receiving it
              const nextStep = {
                ...nextStepData.result,
                stepNumber: agentStateRef.current.steps.length + 1,
              };

              agentStateRef.current = {
                ...agentStateRef.current,
                steps: [...agentStateRef.current.steps, nextStep],
              };

              setUiState((prev) => ({
                ...prev,
                steps: agentStateRef.current.steps,
              }));

              // Break after adding the CLOSE step to UI
              if (nextStepData.done || nextStepData.result.tool === "CLOSE") {
                break;
              }

              // Execute the step
              const executeResponse = await fetch("/api/agent", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  sessionId: sessionData.sessionId,
                  step: nextStepData.result,
                  action: "EXECUTE_STEP",
                }),
              });

              const executeData = await executeResponse.json();

              posthog.capture("agent_execute_step", {
                goal: initialMessage,
                sessionId: sessionData.sessionId,
                contextId: sessionData.contextId,
                step: nextStepData.result,
              });

              if (!executeData.success) {
                throw new Error("Failed to execute step");
              }

              // 如果是USER_INPUT步骤，等待用户确认后再继续
              if (nextStepData.result.tool === "USER_INPUT") {
                // 设置一个状态，表示正在等待用户输入
                setUiState((prev) => ({
                  ...prev,
                  waitingForUserInput: true,
                  userInputMessage: executeData.message || "请处理验证码或登录信息",
                }));
                
                // 等待用户确认
                await new Promise<void>((resolve) => {
                  // 将resolve函数存储在全局变量中，以便用户确认按钮可以调用它
                  (window as ExtendedWindow).continueAfterUserInput = () => {
                    setUiState((prev) => ({
                      ...prev,
                      waitingForUserInput: false,
                    }));
                    resolve();
                  };
                });
              }

              if (executeData.done) {
                break;
              }
            }
          }
        } catch (error) {
          console.error("Session initialization error:", error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    initializeSession();

    // 组件卸载时清理Stagehand实例
    return () => {
      // 只有在会话结束时才清理
      if (isAgentFinished) {
        fetch('/api/cleanup', {
          method: 'POST',
        }).catch(error => {
          console.error('清理Stagehand实例失败:', error);
        });
      }
    };
  }, [initialMessage, isAgentFinished]);

  // Spring configuration for smoother animations
  const springConfig = {
    type: "spring",
    stiffness: 350,
    damping: 30,
  };

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        ...springConfig,
        staggerChildren: 0.1,
      },
    },
    exit: {
      opacity: 0,
      scale: 0.95,
      transition: { duration: 0.2 },
    },
  };

  const messageVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 },
  };

  return (
    <motion.div
      className="min-h-screen bg-gray-50 flex flex-col"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.nav
        className="flex justify-between items-center px-8 py-4 bg-white border-b border-gray-200 shadow-sm"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2">
          <Image
            src="/favicon.svg"
            alt="Manus Lite"
            className="w-8 h-8"
            width={32}
            height={32}
          />
          <span className="font-ppneue text-gray-900">Manus Lite</span>
        </div>
        <motion.button
          onClick={onClose}
          className="px-4 py-2 hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors rounded-md font-ppsupply flex items-center gap-2"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Close
          {!isMobile && (
            <kbd className="px-2 py-1 text-xs bg-gray-100 rounded-md">ESC</kbd>
          )}
        </motion.button>
      </motion.nav>
      <main className="flex-1 flex flex-col items-center p-6">
        <motion.div
          className="w-full max-w-[1280px] bg-white border border-gray-200 shadow-sm rounded-lg overflow-hidden"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="w-full h-12 bg-white border-b border-gray-200 flex items-center px-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
          </div>

          {uiState.sessionUrl && !uiState.isLocalMode ? (
            <div className="flex items-center justify-center mb-4">
              <a
                href={uiState.sessionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline flex items-center"
              >
                <span>查看浏览器会话</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 ml-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            </div>
          ) : uiState.isLocalMode ? (
            <div className="flex items-center justify-center mb-4 text-gray-600">
              <span>使用本地Chromium模式</span>
            </div>
          ) : null}

          <div className="flex flex-col md:flex-row">
            {uiState.sessionUrl && !isAgentFinished && (
              <div className="flex-1 p-6 border-b md:border-b-0 md:border-l border-gray-200 order-first md:order-last">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="w-full aspect-video"
                >
                  <iframe
                    src={uiState.sessionUrl}
                    className="w-full h-full"
                    sandbox="allow-same-origin allow-scripts allow-forms"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    title="Browser Session"
                  />
                </motion.div>
              </div>
            )}

            {isAgentFinished && (
              <div className="flex-1 p-6 border-b md:border-b-0 md:border-l border-gray-200 order-first md:order-last">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="w-full aspect-video"
                >
                  <div className="w-full h-full border border-gray-200 rounded-lg flex items-center justify-center">
                    <p className="text-gray-500 text-center">
                      The agent has completed the task
                      <br />
                      &quot;{initialMessage}&quot;
                    </p>
                  </div>
                </motion.div>
              </div>
            )}

            <div className="md:w-[400px] p-6 min-w-0 h-full">
              <div
                ref={chatContainerRef}
                className="h-full overflow-y-auto space-y-4"
              >
                {initialMessage && (
                  <motion.div
                    variants={messageVariants}
                    className="p-4 bg-blue-50 rounded-lg font-ppsupply"
                  >
                    <p className="font-semibold">Goal:</p>
                    <p>{initialMessage}</p>
                  </motion.div>
                )}

                {uiState.steps.map((step, index) => (
                  <motion.div
                    key={index}
                    variants={messageVariants}
                    className="p-4 bg-white border border-gray-200 rounded-lg font-ppsupply space-y-2"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500">
                        Step {step.stepNumber}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                        {step.tool}
                      </span>
                    </div>
                    <p className="font-medium">{step.text}</p>
                    <p className="text-sm text-gray-600">
                      <span className="font-semibold">Reasoning: </span>
                      {step.reasoning}
                    </p>
                  </motion.div>
                ))}
                {isLoading && (
                  <motion.div
                    variants={messageVariants}
                    className="p-4 bg-gray-50 rounded-lg font-ppsupply animate-pulse"
                  >
                    Processing...
                  </motion.div>
                )}

                {/* 用户输入确认按钮 */}
                {uiState.waitingForUserInput && (
                  <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg shadow-sm">
                    <p className="text-gray-900 mb-4">{uiState.userInputMessage || "请处理验证码或登录信息"}</p>
                    <button
                      onClick={() => {
                        const win = window as ExtendedWindow;
                        if (win.continueAfterUserInput) {
                          win.continueAfterUserInput();
                        }
                      }}
                      className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors"
                    >
                      我已完成，继续执行
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </main>
    </motion.div>
  );
}
