"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import ChatFeed from "./components/ChatFeed";
import AnimatedButton from "./components/AnimatedButton";
import Image from "next/image";
import posthog from "posthog-js";

const Tooltip = ({ children, text }: { children: React.ReactNode; text: string }) => {
  return (
    <div className="relative group">
      {children}
      <span className="absolute hidden group-hover:block w-auto px-3 py-2 min-w-max left-1/2 -translate-x-1/2 translate-y-3 bg-gray-900 text-white text-xs rounded-md font-ppsupply">
        {text}
      </span>
    </div>
  );
};

export default function Home() {
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [initialMessage, setInitialMessage] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle CMD+Enter to submit the form when chat is not visible
      if (!isChatVisible && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const form = document.querySelector("form") as HTMLFormElement;
        if (form) {
          form.requestSubmit();
        }
      }

      // Handle CMD+K to focus input when chat is not visible
      if (!isChatVisible && (e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const input = document.querySelector(
          'input[name="message"]'
        ) as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }

      // Handle ESC to close chat when visible
      if (isChatVisible && e.key === "Escape") {
        e.preventDefault();
        setIsChatVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isChatVisible]);

  const startChat = useCallback(
    (finalMessage: string) => {
      setInitialMessage(finalMessage);
      setIsChatVisible(true);

      try {
        posthog.capture("submit_message", {
          message: finalMessage,
        });
      } catch (e) {
        console.error(e);
      }
    },
    [setInitialMessage, setIsChatVisible]
  );

  return (
    <AnimatePresence mode="wait">
      {!isChatVisible ? (
        <div className="min-h-screen bg-gray-50 flex flex-col">
          {/* Top Navigation */}
          <nav className="flex justify-between items-center px-8 py-4 bg-white border-b border-gray-200">
            <div className="flex items-center gap-3">
              <Image
                src="/favicon.svg"
                alt="Manus Lite"
                className="w-8 h-8"
                width={32}
                height={32}
              />
              <span className="font-ppsupply text-gray-900">Manus Lite</span>
            </div>
            <div className="flex items-center gap-2">
              {/* <a
                href="https://github.com/browserbase/open-operator"
                target="_blank" 
                rel="noopener noreferrer"
              >
                <button className="h-fit flex items-center justify-center px-4 py-2 rounded-md bg-[#1b2128] hover:bg-[#1d232b] gap-1 text-sm font-medium text-white border border-pillSecondary transition-colors duration-200">
                  <Image
                    src="/github.svg"
                    alt="GitHub"
                    width={20}
                    height={20}
                    className="mr-2"
                  />
                  查看 GitHub
                </button>
              </a> */}
            </div>
          </nav>

          {/* Main Content */}
          <main className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-[640px] bg-white border border-gray-200 shadow-sm">
              <div className="w-full h-12 bg-white border-b border-gray-200 flex items-center px-4">
                <div className="flex items-center gap-2">
                  <Tooltip text="为什么要关闭这个？">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                  </Tooltip>
                  <Tooltip text="向🅱️rowserbase开发者致敬">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  </Tooltip>
                  <Tooltip text="@pk_iv 到此一游">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                  </Tooltip>
                </div>
              </div>

              <div className="p-8 flex flex-col items-center gap-8">
                <div className="flex flex-col items-center gap-3">
                  <h1 className="text-2xl font-ppneue text-gray-900 text-center">
                    Manus Lite
                  </h1>
                  <p className="text-base font-ppsupply text-gray-500 text-center">
                    点击运行观看AI浏览网页
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    const input = e.currentTarget.querySelector(
                      'input[name="message"]'
                    ) as HTMLInputElement;
                    const message = (formData.get("message") as string).trim();
                    const finalMessage = message || input.placeholder;
                    startChat(finalMessage);
                  }}
                  className="w-full max-w-[720px] flex flex-col items-center gap-3"
                >
                  <div className="relative w-full">
                    <input
                      name="message"
                      type="text"
                      placeholder="英伟达股票的价格是多少？"
                      className="w-full px-4 py-3 pr-[100px] border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF3B00] focus:border-transparent font-ppsupply"
                    />
                    <AnimatedButton type="submit">运行</AnimatedButton>
                  </div>
                </form>
                <div className="grid grid-cols-2 gap-3 w-full">
                  <button
                    onClick={() =>
                      startChat(
                        "小红书最流行的趋势？"
                      )
                    }
                    className="p-3 text-sm text-gray-600 border border-gray-200 hover:border-[#FF3B00] hover:text-[#FF3B00] transition-colors font-ppsupply text-left"
                  >
                    小红书最流行的趋势？
                  </button>
                  <button
                    onClick={() =>
                      startChat("中国最受欢迎的编程语言是什么？")
                    }
                    className="p-3 text-sm text-gray-600 border border-gray-200 hover:border-[#FF3B00] hover:text-[#FF3B00] transition-colors font-ppsupply text-left"
                  >
                    中国最受欢迎的编程语言是什么？
                  </button>
                  <button
                    onClick={() => startChat("Stephen Curry的场均得分是多少？")}
                    className="p-3 text-sm text-gray-600 border border-gray-200 hover:border-[#FF3B00] hover:text-[#FF3B00] transition-colors font-ppsupply text-left"
                  >
                    库里的场均得分是多少？
                  </button>
                  <button
                    onClick={() => startChat("How much is NVIDIA stock?")}
                    className="p-3 text-sm text-gray-600 border border-gray-200 hover:border-[#FF3B00] hover:text-[#FF3B00] transition-colors font-ppsupply text-left"
                  >
                    英伟达股票价格是多少？
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      ) : (
        <ChatFeed
          initialMessage={initialMessage}
          onClose={() => setIsChatVisible(false)}
        />
      )}
    </AnimatePresence>
  );
}
